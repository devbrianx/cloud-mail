import BizError from '../error/biz-error';

const encoder = new TextEncoder();

function base64url(bytes) {
	return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(value) {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
	return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function encryptionKey(c) {
	const keyMaterial = await crypto.subtle.digest('SHA-256', encoder.encode(c.env.jwt_secret));
	return crypto.subtle.importKey('raw', keyMaterial, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const outlookCryptoService = {
	async encrypt(c, plaintext) {
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(c), encoder.encode(plaintext));
		return `${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
	},

	async decrypt(c, value) {
		try {
			const [encodedIv, encodedCiphertext] = typeof value === 'string' ? value.split('.') : [];
			if (!encodedIv || !encodedCiphertext) throw new Error('missing ciphertext');
			const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64urlDecode(encodedIv) }, await encryptionKey(c), base64urlDecode(encodedCiphertext));
			return new TextDecoder().decode(plaintext);
		} catch {
			throw new BizError('Outlook credential cannot be decrypted', 400);
		}
	}
};

export default outlookCryptoService;
