import BizError from '../error/biz-error';
import outlookCryptoService from './outlook-crypto-service';

const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const graphBaseUrl = 'https://graph.microsoft.com/v1.0';
export const graphDefaultScope = 'https://graph.microsoft.com/.default';
export const graphMailReadScope = 'https://graph.microsoft.com/Mail.Read';

function errorDetail(data) {
	const error = data?.error;
	const errorCode = typeof error === 'string' ? error.trim() : typeof error?.code === 'string' ? error.code.trim() : '';
	const errorMessage = typeof data?.error_description === 'string' ? data.error_description.replace(/\s+/g, ' ').trim().slice(0, 500) : typeof error?.message === 'string' ? error.message.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
	return errorCode && errorMessage ? ` (${errorCode}): ${errorMessage}` : errorCode ? ` (${errorCode})` : errorMessage ? `: ${errorMessage}` : '';
}

function isScopeFallback(error) {
	return error instanceof BizError && error.message.startsWith('Microsoft token refresh failed (invalid_request):') && error.message.includes('AADSTS90023');
}

function isInvalidGraphToken(data) {
	return data?.error?.code === 'InvalidAuthenticationToken' && typeof data.error.message === 'string' && data.error.message.includes('IDX14100');
}

async function persistRefreshToken(c, session, refreshToken) {
	if (refreshToken === session.refreshToken) return;
	session.refreshToken = refreshToken;
	await c.env.db.prepare(`UPDATE outlook_connection SET refresh_token_ciphertext = ?, update_time = CURRENT_TIMESTAMP WHERE outlook_connection_id = ?`).bind(await outlookCryptoService.encrypt(c, refreshToken), session.connection.connection_id).run();
}

export async function refreshGraphToken(c, { clientId, clientSecret, refreshToken, scope }) {
	void c;
	const response = await fetch(tokenUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}), refresh_token: refreshToken, scope })
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new BizError(`Microsoft token refresh failed${errorDetail(data)}`, 400);
	if (!data.access_token) throw new BizError('Microsoft token refresh failed', 400);
	return { accessToken: data.access_token, refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : refreshToken, scope };
}

export async function refreshCompatibleGraphToken(c, credentials) {
	try {
		return await refreshGraphToken(c, { ...credentials, scope: graphDefaultScope });
	} catch (error) {
		if (!isScopeFallback(error)) throw error;
		return refreshGraphToken(c, { ...credentials, scope: graphMailReadScope });
	}
}

async function graphResponse(accessToken, url) {
	const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
	return { response, data: response.ok ? null : await response.json().catch(() => ({})), accessToken };
}

async function refreshMailReadSession(c, session) {
	if (!session.mailReadRefresh) {
		session.triedMailRead = true;
		session.mailReadRefresh = refreshGraphToken(c, { clientId: session.clientId, clientSecret: session.clientSecret, refreshToken: session.refreshToken, scope: graphMailReadScope }).then(async token => {
			await persistRefreshToken(c, session, token.refreshToken);
			session.accessToken = token.accessToken;
			session.scope = token.scope;
		});
	}
	try {
		await session.mailReadRefresh;
	} finally {
		session.mailReadRefresh = null;
	}
}

async function retryInvalidGraphToken(c, session, result, url) {
	if (!isInvalidGraphToken(result.data)) return result;
	if (session.mailReadRefresh) await session.mailReadRefresh;
	if (session.accessToken !== result.accessToken) return graphResponse(session.accessToken, url);
	if (session.triedMailRead) return result;
	await refreshMailReadSession(c, session);
	return graphResponse(session.accessToken, url);
}

function graphFailure(result, message) {
	throw new BizError(`${message}${errorDetail(result.data)}`, result.response.status || 502);
}

const outlookGraphService = {
	async refreshAccessToken(c, connection) {
		const refreshToken = await outlookCryptoService.decrypt(c, connection.refresh_token_ciphertext);
		const clientSecret = connection.client_secret_ciphertext ? await outlookCryptoService.decrypt(c, connection.client_secret_ciphertext) : '';
		const token = await refreshCompatibleGraphToken(c, { clientId: connection.client_id, clientSecret, refreshToken });
		const session = { connection, clientId: connection.client_id, clientSecret, refreshToken, accessToken: token.accessToken, scope: token.scope, triedMailRead: token.scope === graphMailReadScope, mailReadRefresh: null };
		await persistRefreshToken(c, session, token.refreshToken);
		return session;
	},

	async get(c, session, url) {
		let result = await graphResponse(session.accessToken, url);
		if (!result.response.ok) result = await retryInvalidGraphToken(c, session, result, url);
		if (!result.response.ok) graphFailure(result, 'Microsoft Graph request failed');
		return result.response.ok ? await result.response.json() : null;
	},

	async bytes(c, session, url) {
		let result = await graphResponse(session.accessToken, url);
		if (!result.response.ok) result = await retryInvalidGraphToken(c, session, result, url);
		if (!result.response.ok) graphFailure(result, 'Microsoft Graph attachment request failed');
		return new Uint8Array(await result.response.arrayBuffer());
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
