import { beforeEach } from 'vitest';
import { env } from 'cloudflare:test';

const schema = [
	`DROP TABLE IF EXISTS temp_attachment`,
	`DROP TABLE IF EXISTS temp_message`,
	`DROP TABLE IF EXISTS temp_inbox`,
	`DROP TABLE IF EXISTS api_key`,
	`DROP TABLE IF EXISTS attachments`,
	`DROP TABLE IF EXISTS verify_record`,
	`DROP TABLE IF EXISTS setting`,
	`CREATE TABLE setting (register INTEGER NOT NULL DEFAULT 0, receive INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL DEFAULT '', many_email INTEGER NOT NULL DEFAULT 0, add_email INTEGER NOT NULL DEFAULT 0, auto_refresh INTEGER NOT NULL DEFAULT 0, add_email_verify INTEGER NOT NULL DEFAULT 1, register_verify INTEGER NOT NULL DEFAULT 1, reg_verify_count INTEGER NOT NULL DEFAULT 1, add_verify_count INTEGER NOT NULL DEFAULT 1, send INTEGER NOT NULL DEFAULT 1, r2_domain TEXT, secret_key TEXT, site_key TEXT, reg_key INTEGER NOT NULL DEFAULT 1, background TEXT, tg_bot_token TEXT NOT NULL DEFAULT '', tg_chat_id TEXT NOT NULL DEFAULT '', tg_bot_status INTEGER NOT NULL DEFAULT 1, forward_email TEXT NOT NULL DEFAULT '', forward_status INTEGER NOT NULL DEFAULT 1, rule_email TEXT NOT NULL DEFAULT '', rule_type INTEGER NOT NULL DEFAULT 0, login_opacity INTEGER DEFAULT 1, resend_tokens TEXT NOT NULL DEFAULT '{}', notice_title TEXT NOT NULL DEFAULT '', notice_content TEXT NOT NULL DEFAULT '', notice_type TEXT NOT NULL DEFAULT '', notice_duration INTEGER NOT NULL DEFAULT 0, notice_position TEXT NOT NULL DEFAULT '', notice_offset INTEGER NOT NULL DEFAULT 0, notice_width INTEGER NOT NULL DEFAULT 400, notice INTEGER NOT NULL DEFAULT 1, no_recipient INTEGER NOT NULL DEFAULT 1, login_domain INTEGER NOT NULL DEFAULT 0, bucket TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '', s3_access_key TEXT NOT NULL DEFAULT '', s3_secret_key TEXT NOT NULL DEFAULT '', force_path_style INTEGER NOT NULL DEFAULT 1, custom_domain TEXT NOT NULL DEFAULT '', tg_msg_from TEXT NOT NULL DEFAULT 'only-name', tg_msg_to TEXT NOT NULL DEFAULT 'show', tg_msg_text TEXT NOT NULL DEFAULT 'hide', min_email_prefix INTEGER NOT NULL DEFAULT 0, email_prefix_filter TEXT NOT NULL DEFAULT '', api_enabled INTEGER NOT NULL DEFAULT 0, api_domains TEXT NOT NULL DEFAULT 'example.com')`,
	`CREATE TABLE attachments (att_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, email_id INTEGER NOT NULL, account_id INTEGER NOT NULL, key TEXT NOT NULL, filename TEXT, mime_type TEXT, size INTEGER, status INTEGER NOT NULL DEFAULT 0, type INTEGER NOT NULL DEFAULT 0)`,
	`CREATE TABLE verify_record (vr_id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL DEFAULT '', count INTEGER NOT NULL DEFAULT 1, type INTEGER NOT NULL DEFAULT 0, update_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`, 
	`CREATE TABLE api_key (api_key_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, secret_hash TEXT NOT NULL UNIQUE, secret_prefix TEXT NOT NULL, scopes TEXT NOT NULL, revoked_at TEXT, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE temp_inbox (temp_inbox_id TEXT PRIMARY KEY, api_key_id INTEGER NOT NULL, user_id INTEGER NOT NULL, address TEXT NOT NULL UNIQUE COLLATE NOCASE, domain TEXT NOT NULL, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, deleted_at TEXT)`,
	`CREATE TABLE temp_message (temp_message_id INTEGER PRIMARY KEY AUTOINCREMENT, temp_inbox_id TEXT NOT NULL, send_email TEXT, name TEXT, subject TEXT, text TEXT, content TEXT, recipient TEXT NOT NULL DEFAULT '[]', cc TEXT NOT NULL DEFAULT '[]', message_id TEXT NOT NULL DEFAULT '', unread INTEGER NOT NULL DEFAULT 0, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, is_deleted INTEGER NOT NULL DEFAULT 0)`,
	`CREATE TABLE temp_attachment (temp_attachment_id INTEGER PRIMARY KEY AUTOINCREMENT, temp_message_id INTEGER NOT NULL, key TEXT NOT NULL, filename TEXT, mime_type TEXT, size INTEGER, disposition TEXT, content_id TEXT, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`
];

beforeEach(async () => {
	for (const statement of schema) await env.db.prepare(statement).run();
	await env.kv.delete('setting:');
	await env.kv.put('setting:', JSON.stringify({
		register: 0, receive: 0, title: 'Cloud Mail', manyEmail: 0, addEmail: 0, autoRefresh: 0,
		addEmailVerify: 1, registerVerify: 1, regVerifyCount: 1, addVerifyCount: 1, send: 1,
		r2Domain: null, secretKey: null, siteKey: null, regKey: 1, background: null,
		tgBotToken: '', tgChatId: '', tgBotStatus: 1, forwardEmail: '', forwardStatus: 1,
		ruleEmail: '', ruleType: 0, loginOpacity: 1, resendTokens: {}, noticeTitle: '', noticeContent: '',
		noticeType: '', noticeDuration: 0, noticePosition: '', noticeOffset: 0, noticeWidth: 400,
		notice: 1, noRecipient: 1, loginDomain: 0, bucket: '', region: '', endpoint: '',
		s3AccessKey: '', s3SecretKey: '', forcePathStyle: 1, customDomain: '', tgMsgFrom: 'only-name',
		tgMsgTo: 'show', tgMsgText: 'hide', minEmailPrefix: 0, emailPrefixFilter: '', apiEnabled: 0,
		apiDomains: ['example.com']
	}));
});
