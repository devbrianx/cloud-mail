import { and, eq, gt, isNull } from 'drizzle-orm';
import orm from '../entity/orm';
import tempToken from '../entity/temp-token';
import tempInbox from '../entity/temp-inbox';

const encoder = new TextEncoder();

function base64url(bytes) {
	return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function hash(value) {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

const tempTokenService = {
	async issue(c, inbox) {
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		const token = base64url(bytes);
		await orm(c).insert(tempToken).values({
			tokenHash: await hash(token),
			tempInboxId: inbox.tempInboxId,
			expiresAt: inbox.expiresAt
		}).run();
		return token;
	},

	async authenticate(c, value) {
		const match = /^Bearer\s+(.+)$/i.exec(value || '');
		if (!match) return null;
		const tokenHash = await hash(match[1]);
		const now = new Date().toISOString();
		const row = await orm(c).select({ inbox: tempInbox, token: tempToken })
			.from(tempToken).innerJoin(tempInbox, eq(tempToken.tempInboxId, tempInbox.tempInboxId))
			.where(and(eq(tempToken.tokenHash, tokenHash), gt(tempToken.expiresAt, now), gt(tempInbox.expiresAt, now), isNull(tempInbox.deletedAt))).get();
		if (!row) {
			await orm(c).delete(tempToken).where(eq(tempToken.tokenHash, tokenHash)).run();
			return null;
		}
		return { kind: 'tempToken', inbox: row.inbox, token: match[1] };
	},

	async refresh(c, tokenPrincipal, address) {
		if (!address || address.toLowerCase() !== tokenPrincipal.inbox.address.toLowerCase()) return null;
		return { id: tokenPrincipal.inbox.tempInboxId, address: tokenPrincipal.inbox.address, token: await this.issue(c, tokenPrincipal.inbox) };
	}
};

export default tempTokenService;
