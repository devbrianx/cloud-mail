import BizError from '../error/biz-error';
import outlookCryptoService from './outlook-crypto-service';

const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const graphBaseUrl = 'https://graph.microsoft.com/v1.0';

async function responseJson(response, message, code = 502) {
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		const error = typeof data.error === 'string' ? ` (${data.error})` : '';
		throw new BizError(`${message}${error}`, code);
	}
	return data;
}

const outlookGraphService = {
	async refreshAccessToken(c, connection) {
		const refreshToken = await outlookCryptoService.decrypt(c, connection.refresh_token_ciphertext);
		const clientSecret = connection.client_secret_ciphertext ? await outlookCryptoService.decrypt(c, connection.client_secret_ciphertext) : '';
		const response = await fetch(tokenUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ grant_type: 'refresh_token', client_id: connection.client_id, ...(clientSecret ? { client_secret: clientSecret } : {}), refresh_token: refreshToken, scope: 'https://graph.microsoft.com/.default' })
		});
		const token = await responseJson(response, 'Microsoft token refresh failed');
		if (!token.access_token) throw new BizError('Microsoft token refresh failed', 502);
		if (token.refresh_token) {
			await c.env.db.prepare(`UPDATE outlook_connection SET refresh_token_ciphertext = ?, update_time = CURRENT_TIMESTAMP WHERE outlook_connection_id = ?`).bind(await outlookCryptoService.encrypt(c, token.refresh_token), connection.outlook_connection_id).run();
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

	initialDeltaUrl(folder = 'Inbox', receivedAfter) {
		const query = new URLSearchParams({
			'$select': 'id,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments,isRead',
			'$top': '50',
			...(receivedAfter ? { '$filter': `receivedDateTime ge ${receivedAfter}` } : {})
		});
		return `${graphBaseUrl}/me/mailFolders/${encodeURIComponent(folder)}/messages/delta?${query}`;
	},

	attachmentUrl(messageId) {
		return `${graphBaseUrl}/me/messages/${encodeURIComponent(messageId)}/attachments`;
	},

	attachmentValueUrl(messageId, attachmentId) {
		return `${graphBaseUrl}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`;
	}
};

export default outlookGraphService;
