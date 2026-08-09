import BizError from '../error/biz-error';
import outlookCryptoService from './outlook-crypto-service';

const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const graphBaseUrl = 'https://graph.microsoft.com/v1.0';

async function responseJson(response, message, code = 502) {
	if (!response.ok) throw new BizError(message, code);
	return response.json();
}

const outlookGraphService = {
	async refreshAccessToken(c, account) {
		const clientSecret = await outlookCryptoService.decrypt(c, account.client_secret_ciphertext);
		const refreshToken = await outlookCryptoService.decrypt(c, account.refresh_token_ciphertext);
		const response = await fetch(tokenUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ grant_type: 'refresh_token', client_id: account.client_id, client_secret: clientSecret, refresh_token: refreshToken })
		});
		const token = await responseJson(response, 'Microsoft token refresh failed');
		if (!token.access_token) throw new BizError('Microsoft token refresh failed', 502);
		if (token.refresh_token) {
			await c.env.db.prepare(`UPDATE outlook_account SET refresh_token_ciphertext = ?, update_time = CURRENT_TIMESTAMP WHERE outlook_account_id = ?`).bind(await outlookCryptoService.encrypt(c, token.refresh_token), account.outlook_account_id).run();
		}
		return token.access_token;
	},

	async get(accessToken, url) {
		const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
		return responseJson(response, 'Microsoft Graph request failed');
	},

	async bytes(accessToken, url) {
		const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
		if (!response.ok) throw new BizError('Microsoft Graph attachment request failed', 502);
		return new Uint8Array(await response.arrayBuffer());
	},

	initialDeltaUrl() {
		return `${graphBaseUrl}/me/mailFolders/Inbox/messages/delta?$select=id,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments,isRead&$top=50`;
	},

	attachmentUrl(messageId) {
		return `${graphBaseUrl}/me/messages/${encodeURIComponent(messageId)}/attachments`;
	},

	attachmentValueUrl(messageId, attachmentId) {
		return `${graphBaseUrl}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`;
	}
};

export default outlookGraphService;
