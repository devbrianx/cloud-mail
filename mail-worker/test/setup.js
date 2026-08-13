import { beforeEach } from 'vitest';
import { env } from 'cloudflare:test';

const schema = [
	`DROP TABLE IF EXISTS outlook_folder_state`,
	`DROP TABLE IF EXISTS outlook_message`,
	`DROP TABLE IF EXISTS outlook_account_tag`,
	`DROP TABLE IF EXISTS outlook_tag`,
	`DROP TABLE IF EXISTS outlook_group`,
	`DROP TABLE IF EXISTS outlook_connection`,
	`DROP TABLE IF EXISTS email`,
	`DROP TABLE IF EXISTS role_perm`,
	`DROP TABLE IF EXISTS perm`,
	`DROP TABLE IF EXISTS account`,
	`DROP TABLE IF EXISTS user`,
	`DROP TABLE IF EXISTS temp_attachment`,
	`DROP TABLE IF EXISTS temp_message`,
	`DROP TABLE IF EXISTS temp_inbox`,
	`DROP TABLE IF EXISTS temporary_identity`,
	`DROP TABLE IF EXISTS temporary_identity_country`,
	`DROP TABLE IF EXISTS api_key`,
	`DROP TABLE IF EXISTS temp_token`,
	`DROP TABLE IF EXISTS api_key_usage`,
	`DROP TABLE IF EXISTS temp_api_migration`,
	`DROP TABLE IF EXISTS attachments`,
	`DROP TABLE IF EXISTS verify_record`,
	`DROP TABLE IF EXISTS setting`,
	`CREATE TABLE setting (register INTEGER NOT NULL DEFAULT 0, receive INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL DEFAULT '', many_email INTEGER NOT NULL DEFAULT 0, add_email INTEGER NOT NULL DEFAULT 0, auto_refresh INTEGER NOT NULL DEFAULT 0, add_email_verify INTEGER NOT NULL DEFAULT 1, register_verify INTEGER NOT NULL DEFAULT 1, reg_verify_count INTEGER NOT NULL DEFAULT 1, add_verify_count INTEGER NOT NULL DEFAULT 1, send INTEGER NOT NULL DEFAULT 1, r2_domain TEXT, secret_key TEXT, site_key TEXT, reg_key INTEGER NOT NULL DEFAULT 1, background TEXT, tg_bot_token TEXT NOT NULL DEFAULT '', tg_chat_id TEXT NOT NULL DEFAULT '', tg_bot_status INTEGER NOT NULL DEFAULT 1, forward_email TEXT NOT NULL DEFAULT '', forward_status INTEGER NOT NULL DEFAULT 1, rule_email TEXT NOT NULL DEFAULT '', rule_type INTEGER NOT NULL DEFAULT 0, login_opacity INTEGER DEFAULT 1, resend_tokens TEXT NOT NULL DEFAULT '{}', notice_title TEXT NOT NULL DEFAULT '', notice_content TEXT NOT NULL DEFAULT '', notice_type TEXT NOT NULL DEFAULT '', notice_duration INTEGER NOT NULL DEFAULT 0, notice_position TEXT NOT NULL DEFAULT '', notice_offset INTEGER NOT NULL DEFAULT 0, notice_width INTEGER NOT NULL DEFAULT 400, notice INTEGER NOT NULL DEFAULT 1, no_recipient INTEGER NOT NULL DEFAULT 1, login_domain INTEGER NOT NULL DEFAULT 0, bucket TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '', s3_access_key TEXT NOT NULL DEFAULT '', s3_secret_key TEXT NOT NULL DEFAULT '', force_path_style INTEGER NOT NULL DEFAULT 1, custom_domain TEXT NOT NULL DEFAULT '', tg_msg_from TEXT NOT NULL DEFAULT 'only-name', tg_msg_to TEXT NOT NULL DEFAULT 'show', tg_msg_text TEXT NOT NULL DEFAULT 'hide', min_email_prefix INTEGER NOT NULL DEFAULT 0, email_prefix_filter TEXT NOT NULL DEFAULT '', black_subject TEXT NOT NULL DEFAULT '', black_content TEXT NOT NULL DEFAULT '', black_from TEXT NOT NULL DEFAULT '', ai_code INTEGER NOT NULL DEFAULT 1, ai_code_filter TEXT NOT NULL DEFAULT '', api_enabled INTEGER NOT NULL DEFAULT 0, api_domains TEXT NOT NULL DEFAULT 'example.com', api_wildcard_domains TEXT NOT NULL DEFAULT '')`,
	`CREATE TABLE attachments (att_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, email_id INTEGER NOT NULL, account_id INTEGER NOT NULL, key TEXT NOT NULL, filename TEXT, mime_type TEXT, size INTEGER, status INTEGER NOT NULL DEFAULT 0, type INTEGER NOT NULL DEFAULT 0, disposition TEXT, related TEXT, content_id TEXT, encoding TEXT, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE user (user_id INTEGER PRIMARY KEY, email TEXT NOT NULL, type INTEGER NOT NULL DEFAULT 1, password TEXT NOT NULL DEFAULT '', salt TEXT NOT NULL DEFAULT '', status INTEGER NOT NULL DEFAULT 0, is_del INTEGER NOT NULL DEFAULT 0, send_count TEXT DEFAULT '0')`,
	`CREATE TABLE account (account_id INTEGER PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', user_id INTEGER NOT NULL, status INTEGER NOT NULL DEFAULT 0, all_receive INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, is_del INTEGER NOT NULL DEFAULT 0)`,
	`CREATE TABLE role (role_id INTEGER PRIMARY KEY, name TEXT NOT NULL, key TEXT, description TEXT, ban_email TEXT NOT NULL DEFAULT '', ban_email_type INTEGER NOT NULL DEFAULT 0, avail_domain TEXT NOT NULL DEFAULT '', sort INTEGER DEFAULT 0, is_default INTEGER DEFAULT 0, send_count INTEGER, send_type TEXT NOT NULL DEFAULT 'count', account_count INTEGER)`,
	`CREATE TABLE perm (perm_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, perm_key TEXT, pid INTEGER NOT NULL DEFAULT 0, type INTEGER NOT NULL DEFAULT 2, sort REAL)`,
	`CREATE TABLE role_perm (id INTEGER PRIMARY KEY AUTOINCREMENT, role_id INTEGER, perm_id INTEGER)`,
	`CREATE TABLE api_key (api_key_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, secret_hash TEXT NOT NULL UNIQUE, secret_prefix TEXT NOT NULL, secret_ciphertext TEXT NOT NULL DEFAULT '', scopes TEXT NOT NULL, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE temp_inbox (temp_inbox_id TEXT PRIMARY KEY, api_key_id INTEGER NOT NULL, user_id INTEGER NOT NULL, address TEXT NOT NULL UNIQUE COLLATE NOCASE, domain TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'fixed', subdomain TEXT NOT NULL DEFAULT '', create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, deleted_at TEXT)`,
	`CREATE TABLE temp_message (temp_message_id INTEGER PRIMARY KEY AUTOINCREMENT, temp_inbox_id TEXT NOT NULL, send_email TEXT, name TEXT, subject TEXT, text TEXT, content TEXT, recipient TEXT NOT NULL DEFAULT '[]', cc TEXT NOT NULL DEFAULT '[]', message_id TEXT NOT NULL DEFAULT '', unread INTEGER NOT NULL DEFAULT 0, raw_source TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0, starred INTEGER NOT NULL DEFAULT 0, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, is_deleted INTEGER NOT NULL DEFAULT 0)`,
	`CREATE TABLE temp_attachment (temp_attachment_id INTEGER PRIMARY KEY AUTOINCREMENT, temp_message_id INTEGER NOT NULL, key TEXT NOT NULL, filename TEXT, mime_type TEXT, size INTEGER, disposition TEXT, content_id TEXT, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE temp_token (token_hash TEXT PRIMARY KEY, temp_inbox_id TEXT NOT NULL, expires_at TEXT NOT NULL, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE api_key_usage (api_key_id INTEGER NOT NULL, usage_date TEXT NOT NULL, call_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(api_key_id, usage_date))`,
	`CREATE TABLE temporary_identity (rowkey TEXT PRIMARY KEY, user_id INTEGER NOT NULL, full_name TEXT NOT NULL DEFAULT '', temporary_mail TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '', gender TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '未分类', data TEXT NOT NULL, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, update_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE temporary_identity_country (user_id INTEGER NOT NULL, country TEXT NOT NULL, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id, country))`
	,`CREATE TABLE email (email_id INTEGER PRIMARY KEY AUTOINCREMENT, send_email TEXT, name TEXT, account_id INTEGER NOT NULL, user_id INTEGER NOT NULL, subject TEXT, code TEXT NOT NULL DEFAULT '', text TEXT, content TEXT, cc TEXT NOT NULL DEFAULT '[]', bcc TEXT NOT NULL DEFAULT '[]', recipient TEXT, to_email TEXT NOT NULL DEFAULT '', to_name TEXT NOT NULL DEFAULT '', in_reply_to TEXT NOT NULL DEFAULT '', relation TEXT NOT NULL DEFAULT '', message_id TEXT NOT NULL DEFAULT '', type INTEGER NOT NULL DEFAULT 0, status INTEGER NOT NULL DEFAULT 0, resend_email_id TEXT, message TEXT, unread INTEGER NOT NULL DEFAULT 0, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, is_del INTEGER NOT NULL DEFAULT 0)`
	,`CREATE TABLE outlook_account (outlook_account_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, email TEXT NOT NULL COLLATE NOCASE, client_id TEXT NOT NULL, client_secret_ciphertext TEXT NOT NULL, refresh_token_ciphertext TEXT NOT NULL, group_id INTEGER, delta_link TEXT NOT NULL DEFAULT '', sync_status TEXT NOT NULL DEFAULT 'ready', sync_error TEXT NOT NULL DEFAULT '', last_sync_time TEXT, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, update_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, is_del INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id, email))`
	,`CREATE TABLE outlook_group (outlook_group_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL COLLATE NOCASE, sort INTEGER NOT NULL DEFAULT 0, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, update_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, name))`
	,`CREATE TABLE outlook_tag (outlook_tag_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL COLLATE NOCASE, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, name))`
	,`CREATE TABLE outlook_account_tag (outlook_account_id INTEGER NOT NULL, outlook_tag_id INTEGER NOT NULL, PRIMARY KEY(outlook_account_id, outlook_tag_id))`
	,`CREATE TABLE outlook_message (outlook_account_id INTEGER NOT NULL, graph_message_id TEXT NOT NULL, email_id INTEGER NOT NULL, folder TEXT NOT NULL DEFAULT 'inbox', PRIMARY KEY(outlook_account_id, graph_message_id))`
	,`CREATE INDEX outlook_message_email_folder_idx ON outlook_message(email_id, folder)`
	,`CREATE TABLE outlook_folder_state (outlook_connection_id INTEGER NOT NULL, folder TEXT NOT NULL, delta_link TEXT NOT NULL DEFAULT '', PRIMARY KEY(outlook_connection_id, folder))`
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
		apiDomains: ['example.com', 'alt.example.com'], apiWildcardDomains: ['example.com']
	}));
	await env.db.prepare(`INSERT INTO role (role_id, name, key) VALUES (1, 'test', '')`).run();
	await env.db.prepare(`INSERT INTO user (user_id, email, type) VALUES (1, 'user@example.com', 1), (2, 'admin@example.com', 1)`).run();
	await env.db.prepare(`INSERT INTO account (account_id, email, name, user_id) VALUES (1, 'user@example.com', 'user', 1), (2, 'admin@example.com', 'admin', 2)`).run();
});
