import settingService from '../service/setting-service';
import emailUtils from '../utils/email-utils';
import {emailConst} from "../const/entity-const";

const dbInit = {
	async init(c) {

		const secret = c.req.param('secret');

		if (secret !== c.env.jwt_secret) {
			return c.text('❌ JWT secret mismatch');
		}

		await this.intDB(c);
		await this.v1_1DB(c);
		await this.v1_2DB(c);
		await this.v1_3DB(c);
		await this.v1_3_1DB(c);
		await this.v1_4DB(c);
		await this.v1_5DB(c);
		await this.v1_6DB(c);
		await this.v1_7DB(c);
		await this.v2DB(c);
		await this.v2_3DB(c);
		await this.v2_4DB(c);
		await this.v2_5DB(c);
		await this.v2_6DB(c);
		await this.v2_7DB(c);
		await this.v2_8DB(c);
		await this.v2_9DB(c);
		await this.v3_0DB(c);
		await this.v3DB(c);
		await this.v3_1DB(c);
		await this.v3_2DB(c);
		await this.v3_3DB(c);
		await this.v3_4DB(c);
		await this.v3_5DB(c);
		await this.v3_6DB(c);
		await this.v3_7DB(c);
		await this.v3_9DB(c);
		await this.v3_10DB(c);
		await this.v3_11DB(c);
		await this.v3_12DB(c);
		await settingService.refresh(c);
		return c.text('success');
	},

	async v3_0DB(c) {
		try {
			await c.env.db.batch([
				await c.env.db.prepare(`ALTER TABLE email ADD COLUMN code TEXT NOT NULL DEFAULT '';`),
				await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN ai_code INTEGER NOT NULL DEFAULT 1;`),
				await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN ai_code_filter TEXT NOT NULL DEFAULT '';`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

		try {
			await c.env.db.batch([
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN black_subject TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN black_content TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN black_from TEXT NOT NULL DEFAULT '';`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v3DB(c) {
		const statements = [
			`ALTER TABLE setting ADD COLUMN api_enabled INTEGER NOT NULL DEFAULT 1`,
			`ALTER TABLE setting ADD COLUMN api_domains TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE setting ADD COLUMN api_wildcard_domains TEXT NOT NULL DEFAULT ''`,
			`CREATE TABLE IF NOT EXISTS api_key (api_key_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, secret_hash TEXT NOT NULL UNIQUE, secret_prefix TEXT NOT NULL, scopes TEXT NOT NULL, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
			`CREATE TABLE IF NOT EXISTS temp_inbox (temp_inbox_id TEXT PRIMARY KEY, api_key_id INTEGER NOT NULL, user_id INTEGER NOT NULL, address TEXT NOT NULL UNIQUE COLLATE NOCASE, domain TEXT NOT NULL, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, deleted_at TEXT)`,
			`CREATE TABLE IF NOT EXISTS temp_message (temp_message_id INTEGER PRIMARY KEY AUTOINCREMENT, temp_inbox_id TEXT NOT NULL, send_email TEXT, name TEXT, subject TEXT, text TEXT, content TEXT, recipient TEXT NOT NULL DEFAULT '[]', cc TEXT NOT NULL DEFAULT '[]', message_id TEXT NOT NULL DEFAULT '', unread INTEGER NOT NULL DEFAULT 0, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, is_deleted INTEGER NOT NULL DEFAULT 0)`,
			`CREATE TABLE IF NOT EXISTS temp_attachment (temp_attachment_id INTEGER PRIMARY KEY AUTOINCREMENT, temp_message_id INTEGER NOT NULL, key TEXT NOT NULL, filename TEXT, mime_type TEXT, size INTEGER, disposition TEXT, content_id TEXT, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`
		];

		for (const statement of statements) {
			try {
				await c.env.db.prepare(statement).run();
			} catch (error) {
				console.warn(`Skipping API migration: ${error.message}`);
			}
		}

		for (const statement of [
			`CREATE INDEX IF NOT EXISTS api_key_user_idx ON api_key(user_id)`,
			`CREATE INDEX IF NOT EXISTS temp_inbox_key_expiry_idx ON temp_inbox(api_key_id, expires_at)`,
			`CREATE INDEX IF NOT EXISTS temp_inbox_address_idx ON temp_inbox(address)`,
			`CREATE INDEX IF NOT EXISTS temp_message_inbox_idx ON temp_message(temp_inbox_id, is_deleted, temp_message_id)`,
			`CREATE INDEX IF NOT EXISTS temp_attachment_message_idx ON temp_attachment(temp_message_id)`
		]) {
			await c.env.db.prepare(statement).run();
		}
	},

	async v3_1DB(c) {
		await c.env.db.prepare(`
			INSERT INTO perm (name, perm_key, pid, type, sort)
			SELECT '临时邮箱 API', NULL, 0, 1, 5.2
			WHERE NOT EXISTS (
				SELECT 1 FROM perm WHERE name = '临时邮箱 API' AND perm_key IS NULL AND pid = 0
			)
		`).run();
		const parent = await c.env.db.prepare(`
			SELECT perm_id FROM perm WHERE name = '临时邮箱 API' AND perm_key IS NULL AND pid = 0
		`).first();
		await c.env.db.prepare(`
			INSERT INTO perm (name, perm_key, pid, type, sort)
			SELECT 'API 密钥', 'api-key:query', ?, 2, 0
			WHERE NOT EXISTS (SELECT 1 FROM perm WHERE perm_key = 'api-key:query')
		`).bind(parent.perm_id).run();
	},

	async v3_2DB(c) {
		const statements = [
			`ALTER TABLE setting ADD COLUMN api_wildcard_domains TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE temp_inbox ADD COLUMN mode TEXT NOT NULL DEFAULT 'fixed'`,
			`ALTER TABLE temp_inbox ADD COLUMN subdomain TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE temp_message ADD COLUMN raw_source TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE temp_message ADD COLUMN size INTEGER NOT NULL DEFAULT 0`,
			`ALTER TABLE temp_message ADD COLUMN starred INTEGER NOT NULL DEFAULT 0`,
			`CREATE TABLE IF NOT EXISTS temp_token (token_hash TEXT PRIMARY KEY, temp_inbox_id TEXT NOT NULL, expires_at TEXT NOT NULL, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
			`CREATE TABLE IF NOT EXISTS api_key_usage (api_key_id INTEGER NOT NULL, usage_date TEXT NOT NULL, call_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(api_key_id, usage_date))`,
			`CREATE TABLE IF NOT EXISTS temp_api_migration (version TEXT PRIMARY KEY)`
		];
		for (const statement of statements) {
			try {
				await c.env.db.prepare(statement).run();
			} catch (error) {
				console.warn(`Skipping temporary API migration statement: ${error.message}`);
			}
		}
		for (const statement of [
			`CREATE INDEX IF NOT EXISTS temp_token_inbox_expiry_idx ON temp_token(temp_inbox_id, expires_at)`,
			`CREATE INDEX IF NOT EXISTS api_key_usage_date_idx ON api_key_usage(usage_date)`
		]) await c.env.db.prepare(statement).run();
		const applied = await c.env.db.prepare(`SELECT version FROM temp_api_migration WHERE version = 'v3_2'`).first();
		if (applied) return;
		const attachments = await c.env.db.prepare(`SELECT key FROM temp_attachment`).all();
		await c.env.db.batch([
			c.env.db.prepare(`DELETE FROM temp_token`),
			c.env.db.prepare(`DELETE FROM temp_attachment`),
			c.env.db.prepare(`DELETE FROM temp_message`),
			c.env.db.prepare(`DELETE FROM temp_inbox`),
			c.env.db.prepare(`DELETE FROM api_key`),
			c.env.db.prepare(`DELETE FROM api_key_usage`)
		]);
		const { default: tempInboxService } = await import('../service/temp-inbox-service');
		for (const attachment of attachments.results) await tempInboxService.deleteObjectIfUnreferenced(c, attachment.key);
		await c.env.db.prepare(`INSERT INTO temp_api_migration(version) VALUES ('v3_2')`).run();
	},

	async v3_3DB(c) {
		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN favicon TEXT NOT NULL DEFAULT ''`).run();
		} catch (error) {
			console.warn(`Skipping favicon migration statement: ${error.message}`);
		}
	},

	async v3_4DB(c) {
		try {
			await c.env.db.prepare(`ALTER TABLE api_key ADD COLUMN secret_ciphertext TEXT NOT NULL DEFAULT ''`).run();
		} catch (error) {
			console.warn(`Skipping API key ciphertext migration: ${error.message}`);
		}
		await c.env.db.prepare(`CREATE TABLE IF NOT EXISTS temporary_identity (rowkey TEXT PRIMARY KEY, full_name TEXT NOT NULL DEFAULT '', temporary_mail TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '', gender TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', data TEXT NOT NULL, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, update_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
		await c.env.db.prepare(`CREATE INDEX IF NOT EXISTS temporary_identity_updated_idx ON temporary_identity(update_time)`).run();
	},

	async v3_5DB(c) {
		try {
			await c.env.db.prepare(`ALTER TABLE temporary_identity ADD COLUMN country TEXT NOT NULL DEFAULT '未分类'`).run();
		} catch (error) {
			console.warn(`Skipping temporary identity country migration: ${error.message}`);
		}
		await c.env.db.prepare(`CREATE TABLE IF NOT EXISTS temporary_identity_country (country TEXT PRIMARY KEY, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
		await c.env.db.prepare(`CREATE INDEX IF NOT EXISTS temporary_identity_country_updated_idx ON temporary_identity(country, update_time)`).run();
		await c.env.db.prepare(`INSERT OR IGNORE INTO temporary_identity_country(country) SELECT DISTINCT country FROM temporary_identity WHERE trim(country) <> ''`).run();
	},

	async v3_6DB(c) {
		for (const statement of [
			`CREATE TABLE IF NOT EXISTS outlook_account (outlook_account_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, email TEXT NOT NULL COLLATE NOCASE, client_id TEXT NOT NULL, client_secret_ciphertext TEXT NOT NULL, refresh_token_ciphertext TEXT NOT NULL, group_id INTEGER, delta_link TEXT NOT NULL DEFAULT '', sync_status TEXT NOT NULL DEFAULT 'ready', sync_error TEXT NOT NULL DEFAULT '', last_sync_time TEXT, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, update_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, is_del INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id, email))`,
			`CREATE TABLE IF NOT EXISTS outlook_group (outlook_group_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL COLLATE NOCASE, sort INTEGER NOT NULL DEFAULT 0, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, update_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, name))`,
			`CREATE TABLE IF NOT EXISTS outlook_tag (outlook_tag_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL COLLATE NOCASE, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, name))`,
			`CREATE TABLE IF NOT EXISTS outlook_account_tag (outlook_account_id INTEGER NOT NULL, outlook_tag_id INTEGER NOT NULL, PRIMARY KEY(outlook_account_id, outlook_tag_id))`,
			`CREATE TABLE IF NOT EXISTS outlook_message (outlook_account_id INTEGER NOT NULL, graph_message_id TEXT NOT NULL, email_id INTEGER NOT NULL, PRIMARY KEY(outlook_account_id, graph_message_id))`
		]) await c.env.db.prepare(statement).run();
		for (const statement of [
			`CREATE INDEX IF NOT EXISTS outlook_account_user_group_idx ON outlook_account(user_id, is_del, group_id)`,
			`CREATE INDEX IF NOT EXISTS outlook_account_user_idx ON outlook_account(user_id, is_del)`,
			`CREATE INDEX IF NOT EXISTS outlook_account_tag_tag_idx ON outlook_account_tag(outlook_tag_id)`,
			`CREATE INDEX IF NOT EXISTS outlook_message_email_idx ON outlook_message(email_id)`
		]) await c.env.db.prepare(statement).run();
		await c.env.db.prepare(`INSERT INTO perm (name, perm_key, pid, type, sort) SELECT 'Outlook 邮箱管理', 'outlook:query', 0, 2, 5.4 WHERE NOT EXISTS (SELECT 1 FROM perm WHERE name = 'Outlook 邮箱管理' AND pid = 0)`).run();
	},

	async v3_7DB(c) {
		await c.env.db.prepare(`CREATE TABLE IF NOT EXISTS outlook_connection (outlook_connection_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, provider_email TEXT NOT NULL COLLATE NOCASE, provider_user_principal_name TEXT NOT NULL DEFAULT '', client_id TEXT NOT NULL, client_secret_ciphertext TEXT NOT NULL DEFAULT '', refresh_token_ciphertext TEXT NOT NULL, sync_status TEXT NOT NULL DEFAULT 'ready', sync_error TEXT NOT NULL DEFAULT '', last_sync_time TEXT, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, update_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, is_del INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id, provider_email, client_id))`).run();
		for (const statement of [
			`ALTER TABLE outlook_account ADD COLUMN outlook_connection_id INTEGER`
		]) {
			try { await c.env.db.prepare(statement).run(); } catch (error) { console.warn(`Skipping Outlook connection migration statement: ${error.message}`); }
		}
		await c.env.db.prepare(`INSERT OR IGNORE INTO outlook_connection(user_id, provider_email, client_id, client_secret_ciphertext, refresh_token_ciphertext, sync_status, sync_error, last_sync_time, create_time, update_time, is_del) SELECT user_id, email, client_id, client_secret_ciphertext, refresh_token_ciphertext, sync_status, sync_error, last_sync_time, create_time, update_time, is_del FROM outlook_account WHERE outlook_connection_id IS NULL AND client_id <> '' AND refresh_token_ciphertext <> ''`).run();
		await c.env.db.prepare(`UPDATE outlook_account SET outlook_connection_id = (SELECT outlook_connection_id FROM outlook_connection c WHERE c.user_id = outlook_account.user_id AND c.provider_email = outlook_account.email AND c.client_id = outlook_account.client_id) WHERE outlook_connection_id IS NULL`).run();
		await c.env.db.prepare(`CREATE INDEX IF NOT EXISTS outlook_connection_user_idx ON outlook_connection(user_id, is_del)`).run();
		await c.env.db.prepare(`CREATE INDEX IF NOT EXISTS outlook_account_connection_idx ON outlook_account(outlook_connection_id, is_del)`).run();
	},


	async v3_9DB(c) {
		try { await c.env.db.prepare(`ALTER TABLE outlook_message ADD COLUMN folder TEXT NOT NULL DEFAULT 'inbox'`).run(); } catch (error) { console.warn(`Skipping Outlook folder migration statement: ${error.message}`); }
		await c.env.db.prepare(`CREATE TABLE IF NOT EXISTS outlook_folder_state (outlook_connection_id INTEGER NOT NULL, folder TEXT NOT NULL, delta_link TEXT NOT NULL DEFAULT '', PRIMARY KEY(outlook_connection_id, folder))`).run();
		await c.env.db.prepare(`INSERT OR IGNORE INTO outlook_folder_state(outlook_connection_id, folder, delta_link) SELECT outlook_connection_id, 'inbox', delta_link FROM outlook_account WHERE outlook_connection_id IS NOT NULL`).run();
	},

	async v3_10DB(c) {
		try {
			await c.env.db.prepare(`ALTER TABLE outlook_group ADD COLUMN sort INTEGER NOT NULL DEFAULT 0`).run();
			await c.env.db.prepare(`UPDATE outlook_group AS target SET sort = (SELECT COUNT(*) FROM outlook_group AS prior WHERE prior.user_id = target.user_id AND prior.name COLLATE NOCASE < target.name COLLATE NOCASE)`).run();
		} catch (error) {
			if (!/duplicate column name/i.test(error.message)) throw error;
		}
	},

	async v3_11DB(c) {
		for (const statement of [
			`CREATE INDEX IF NOT EXISTS outlook_message_email_folder_idx ON outlook_message(email_id, folder)`,
			`CREATE INDEX IF NOT EXISTS email_mailbox_list_idx ON email(user_id, account_id, type, is_del, email_id DESC)`
		]) await c.env.db.prepare(statement).run();

		await c.env.db.batch([
			c.env.db.prepare(`DELETE FROM role_perm WHERE perm_id IN (SELECT perm_id FROM perm WHERE perm_key IN ('temporary-identity:query', 'temporary-identity:add', 'temporary-identity:set', 'temporary-identity:delete'))`),
			c.env.db.prepare(`DELETE FROM perm WHERE perm_key IN ('temporary-identity:query', 'temporary-identity:add', 'temporary-identity:set', 'temporary-identity:delete')`),
			c.env.db.prepare(`DELETE FROM perm WHERE name = '临时身份' AND perm_key IS NULL AND pid = 0 AND NOT EXISTS (SELECT 1 FROM perm child WHERE child.pid = perm.perm_id)`)
		]);

		const identityColumns = (await c.env.db.prepare(`PRAGMA table_info(temporary_identity)`).all()).results;
		const countryColumns = (await c.env.db.prepare(`PRAGMA table_info(temporary_identity_country)`).all()).results;
		const hasIdentityUserId = identityColumns.some(column => column.name === 'user_id');
		const hasPrivateCountries = countryColumns.some(column => column.name === 'user_id' && column.pk) && countryColumns.some(column => column.name === 'country' && column.pk);
		const needsOwner = !hasIdentityUserId || !hasPrivateCountries;
		const identityCount = Number((await c.env.db.prepare(`SELECT COUNT(*) total FROM temporary_identity`).first()).total);
		const countryCount = Number((await c.env.db.prepare(`SELECT COUNT(*) total FROM temporary_identity_country`).first()).total);
		let adminUserId = null;
		if (needsOwner && (identityCount || countryCount)) {
			const admin = await c.env.db.prepare(`SELECT user_id FROM user WHERE email COLLATE NOCASE = ? AND is_del = 0`).bind(c.env.admin).first();
			if (!admin) throw new Error('Temporary identity migration requires an active administrator user');
			adminUserId = admin.user_id;
		}

		if (!hasIdentityUserId) await c.env.db.prepare(`ALTER TABLE temporary_identity ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0`).run();
		if (adminUserId !== null) await c.env.db.prepare(`UPDATE temporary_identity SET user_id = ? WHERE user_id = 0`).bind(adminUserId).run();

		if (!hasPrivateCountries) {
			const statements = [
				c.env.db.prepare(`DROP INDEX IF EXISTS temporary_identity_country_updated_idx`),
				c.env.db.prepare(`CREATE TABLE temporary_identity_country_new (user_id INTEGER NOT NULL, country TEXT NOT NULL, create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id, country))`)
			];
			if (adminUserId !== null) statements.push(c.env.db.prepare(`INSERT OR IGNORE INTO temporary_identity_country_new(user_id, country, create_time) SELECT ?, country, create_time FROM temporary_identity_country`).bind(adminUserId));
			statements.push(
				c.env.db.prepare(`INSERT OR IGNORE INTO temporary_identity_country_new(user_id, country, create_time) SELECT user_id, country, MIN(create_time) FROM temporary_identity WHERE trim(country) <> '' GROUP BY user_id, country`),
				c.env.db.prepare(`DROP TABLE temporary_identity_country`),
				c.env.db.prepare(`ALTER TABLE temporary_identity_country_new RENAME TO temporary_identity_country`)
			);
			await c.env.db.batch(statements);
		}
		await c.env.db.batch([
			c.env.db.prepare(`DROP INDEX IF EXISTS temporary_identity_country_updated_idx`),
			c.env.db.prepare(`CREATE INDEX IF NOT EXISTS temporary_identity_user_country_updated_idx ON temporary_identity(user_id, country, update_time)`)
		]);
	},

	async v3_12DB(c) {
		const legacyKeys = ['outlook-account:query', 'outlook-account:add', 'outlook-account:set', 'outlook-account:delete', 'outlook-group:query', 'outlook-group:add', 'outlook-group:set', 'outlook-group:delete', 'outlook-tag:query', 'outlook-tag:add', 'outlook-tag:set', 'outlook-tag:delete', 'outlook-sync:run'];
		const placeholders = legacyKeys.map(() => '?').join(',');
		await c.env.db.prepare(`INSERT INTO perm (name, perm_key, pid, type, sort) SELECT 'Outlook 邮箱管理', 'outlook:query', 0, 2, 5.4 WHERE NOT EXISTS (SELECT 1 FROM perm WHERE name = 'Outlook 邮箱管理' AND pid = 0)`).run();
		await c.env.db.prepare(`UPDATE perm SET perm_key = 'outlook:query', type = 2, sort = 5.4 WHERE name = 'Outlook 邮箱管理' AND pid = 0`).run();
		const outlookPerm = await c.env.db.prepare(`SELECT perm_id FROM perm WHERE name = 'Outlook 邮箱管理' AND pid = 0`).first();
		await c.env.db.prepare(`INSERT INTO role_perm(role_id, perm_id) SELECT DISTINCT legacy.role_id, ? FROM role_perm legacy JOIN perm legacy_perm ON legacy_perm.perm_id = legacy.perm_id WHERE legacy_perm.perm_key IN (${placeholders}) AND NOT EXISTS (SELECT 1 FROM role_perm current WHERE current.role_id = legacy.role_id AND current.perm_id = ?)`).bind(outlookPerm.perm_id, ...legacyKeys, outlookPerm.perm_id).run();
		await c.env.db.batch([
			c.env.db.prepare(`DELETE FROM role_perm WHERE perm_id IN (SELECT perm_id FROM perm WHERE perm_key IN (${placeholders}))`).bind(...legacyKeys),
			c.env.db.prepare(`DELETE FROM perm WHERE perm_key IN (${placeholders})`).bind(...legacyKeys)
		]);
	},

	async v2_9DB(c) {
		try {
			await c.env.db.prepare(`UPDATE setting SET auto_refresh = 5 WHERE auto_refresh = 1;`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v2_8DB(c) {
		try {
			await c.env.db.batch([
				c.env.db.prepare(`ALTER TABLE account ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v2_7DB(c) {
		try {
			await c.env.db.batch([
				c.env.db.prepare(`ALTER TABLE setting RENAME COLUMN auto_refresh_time TO auto_refresh;`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v2_6DB(c) {
		try {
			await c.env.db.prepare(`ALTER TABLE account ADD COLUMN all_receive INTEGER NOT NULL DEFAULT 0;`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v2_5DB(c) {

		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN email_prefix_filter text NOT NULL DEFAULT '';`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

		try {
			await c.env.db.batch([
				c.env.db.prepare(`ALTER TABLE email ADD COLUMN unread INTEGER NOT NULL DEFAULT 0;`),
				c.env.db.prepare(`UPDATE email SET unread = 1;`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

	},

	async v2_4DB(c) {
		try {
			await c.env.db.prepare(`
				CREATE TABLE IF NOT EXISTS oauth (
					oauth_id INTEGER PRIMARY KEY AUTOINCREMENT,
					oauth_user_id TEXT,
					username TEXT,
					name TEXT,
					avatar TEXT,
					active INTEGER,
					trust_level INTEGER,
					silenced INTEGER,
					create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
					platform INTEGER NOT NULL DEFAULT 0,
					user_id INTEGER NOT NULL DEFAULT 0
				)
			`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN min_email_prefix INTEGER NOT NULL DEFAULT 1;`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

	},

	async v2_3DB(c) {
		try {
			await c.env.db.batch([
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN force_path_style	INTEGER NOT NULL DEFAULT 1;`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN custom_domain TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN tg_msg_to TEXT NOT NULL DEFAULT 'show';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN tg_msg_from TEXT NOT NULL DEFAULT 'only-name';`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN tg_msg_text TEXT NOT NULL DEFAULT 'show';`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

	},

	async v2DB(c) {
		try {
			await c.env.db.batch([
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN bucket TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN region TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN endpoint TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN s3_access_key TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN s3_secret_key TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`DELETE FROM perm WHERE perm_key = 'setting:clean'`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v1_7DB(c) {
		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN login_domain INTEGER NOT NULL DEFAULT 0;`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v1_6DB(c) {

		const noticeContent = '本项目仅供学习交流，禁止用于违法业务\n' +
			'<br>\n' +
			'请遵守当地法规，作者不承担任何法律责任'

		const ADD_COLUMN_SQL_LIST = [
			`ALTER TABLE setting ADD COLUMN reg_verify_count INTEGER NOT NULL DEFAULT 1;`,
			`ALTER TABLE setting ADD COLUMN add_verify_count INTEGER NOT NULL DEFAULT 1;`,
			`CREATE TABLE IF NOT EXISTS verify_record (
				vr_id INTEGER PRIMARY KEY AUTOINCREMENT,
				ip TEXT NOT NULL DEFAULT '',
				count INTEGER NOT NULL DEFAULT 1,
				type INTEGER NOT NULL DEFAULT 0,
				update_time DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
			`ALTER TABLE setting ADD COLUMN notice_title TEXT NOT NULL DEFAULT 'Cloud Mail';`,
			`ALTER TABLE setting ADD COLUMN notice_content TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN notice_type TEXT NOT NULL DEFAULT 'none';`,
			`ALTER TABLE setting ADD COLUMN notice_duration INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE setting ADD COLUMN notice_offset INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE setting ADD COLUMN notice_position TEXT NOT NULL DEFAULT 'top-right';`,
			`ALTER TABLE setting ADD COLUMN notice_width INTEGER NOT NULL DEFAULT 340;`,
			`ALTER TABLE setting ADD COLUMN notice INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE setting ADD COLUMN no_recipient INTEGER NOT NULL DEFAULT 1;`,
			`UPDATE role SET avail_domain = '' WHERE role.avail_domain LIKE '@%';`,
			`CREATE INDEX IF NOT EXISTS idx_email_user_id_account_id ON email(user_id, account_id);`
		];

		const promises = ADD_COLUMN_SQL_LIST.map(async (sql) => {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段：${e.message}`);
			}
		});

		await Promise.all(promises);
		await c.env.db.prepare(`UPDATE setting SET notice_content = ? WHERE notice_content = '';`).bind(noticeContent).run();
		try {
			await c.env.db.batch([
				c.env.db.prepare(`DROP INDEX IF EXISTS idx_account_email`),
				c.env.db.prepare(`DROP INDEX IF EXISTS idx_user_email`),
				c.env.db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_account_email_nocase ON account (email COLLATE NOCASE)`),
				c.env.db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email_nocase ON user (email COLLATE NOCASE)`)
			]);
		} catch (e) {
			console.warn(e.message)
		}

	},

	async v1_5DB(c) {
		await c.env.db.prepare(`UPDATE perm SET perm_key = 'all-email:query' WHERE perm_key = 'sys-email:query'`).run();
		await c.env.db.prepare(`UPDATE perm SET perm_key = 'all-email:delete' WHERE perm_key = 'sys-email:delete'`).run();
		try {
			await c.env.db.prepare(`ALTER TABLE role ADD COLUMN avail_domain TEXT NOT NULL DEFAULT ''`).run();
		} catch (e) {
			console.warn(`跳过字段添加：${e.message}`);
		}
	},

	async v1_4DB(c) {
		await c.env.db.prepare(`
      CREATE TABLE IF NOT EXISTS reg_key (
				rege_key_id INTEGER PRIMARY KEY AUTOINCREMENT,
				code TEXT NOT NULL COLLATE NOCASE DEFAULT '',
				count INTEGER NOT NULL DEFAULT 0,
				role_id INTEGER NOT NULL DEFAULT 0,
				user_id INTEGER NOT NULL DEFAULT 0,
				expire_time DATETIME,
				create_time DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

		// 添加不区分大小写的唯一索引
		try {
			await c.env.db.prepare(`
				CREATE UNIQUE INDEX IF NOT EXISTS idx_setting_code ON reg_key(code COLLATE NOCASE)
			`).run();
		} catch (e) {
			console.warn(`跳过创建索引：${e.message}`);
		}


		try {
			await c.env.db.prepare(`
        INSERT INTO perm (perm_id, name, perm_key, pid, type, sort) VALUES
        (33,'注册密钥', NULL, 0, 1, 5.1),
        (34,'密钥查看', 'reg-key:query', 33, 2, 0),
        (35,'密钥添加', 'reg-key:add', 33, 2, 1),
        (36,'密钥删除', 'reg-key:delete', 33, 2, 2)`).run();
		} catch (e) {
			console.warn(`跳过数据：${e.message}`);
		}

		const ADD_COLUMN_SQL_LIST = [
			`ALTER TABLE setting ADD COLUMN reg_key INTEGER NOT NULL DEFAULT 1;`,
			`ALTER TABLE role ADD COLUMN ban_email TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE role ADD COLUMN ban_email_type INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE user ADD COLUMN reg_key_id INTEGER NOT NULL DEFAULT 0;`
		];

		const promises = ADD_COLUMN_SQL_LIST.map(async (sql) => {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段添加：${e.message}`);
			}
		});

		await Promise.all(promises);

	},

	async v1_3_1DB(c) {
		await c.env.db.prepare(`UPDATE email SET name = SUBSTR(send_email, 1, INSTR(send_email, '@') - 1) WHERE (name IS NULL OR name = '') AND type = ${emailConst.type.RECEIVE}`).run();
	},

	async v1_3DB(c) {

		const ADD_COLUMN_SQL_LIST = [
			`ALTER TABLE setting ADD COLUMN tg_bot_token TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN tg_chat_id TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN tg_bot_status INTEGER NOT NULL DEFAULT 1;`,
			`ALTER TABLE setting ADD COLUMN forward_email TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN forward_status INTEGER TIME NOT NULL DEFAULT 1;`,
			`ALTER TABLE setting ADD COLUMN rule_email TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN rule_type INTEGER NOT NULL DEFAULT 0;`
		];

		const promises = ADD_COLUMN_SQL_LIST.map(async (sql) => {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段添加：${e.message}`);
			}
		});

		await Promise.all(promises);

		const nameColumn = await c.env.db.prepare(`SELECT * FROM pragma_table_info('email') WHERE name = 'to_email' limit 1`).first();

		if (nameColumn) {
			return
		}

		const queryList = []

		queryList.push(c.env.db.prepare(`ALTER TABLE email ADD COLUMN to_email TEXT NOT NULL DEFAULT ''`));
		queryList.push(c.env.db.prepare(`ALTER TABLE email ADD COLUMN to_name TEXT NOT NULL DEFAULT ''`));
		queryList.push(c.env.db.prepare(`UPDATE email SET to_email = json_extract(recipient, '$[0].address'), to_name = json_extract(recipient, '$[0].name')`));

		await c.env.db.batch(queryList);

	},

	async v1_2DB(c){

		const ADD_COLUMN_SQL_LIST = [
			`ALTER TABLE email ADD COLUMN recipient TEXT NOT NULL DEFAULT '[]';`,
			`ALTER TABLE email ADD COLUMN cc TEXT NOT NULL DEFAULT '[]';`,
			`ALTER TABLE email ADD COLUMN bcc TEXT NOT NULL DEFAULT '[]';`,
			`ALTER TABLE email ADD COLUMN message_id TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE email ADD COLUMN in_reply_to TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE email ADD COLUMN relation TEXT NOT NULL DEFAULT '';`
		];

		const promises = ADD_COLUMN_SQL_LIST.map(async (sql) => {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段添加：${e.message}`);
			}
		});

		await Promise.all(promises);

		await this.receiveEmailToRecipient(c);
		await this.initAccountName(c);

		try {
			await c.env.db.prepare(`
        INSERT INTO perm (perm_id, name, perm_key, pid, type, sort) VALUES
        (31,'分析页', NULL, 0, 1, 2.1),
        (32,'数据查看', 'analysis:query', 31, 2, 1)`).run();
		} catch (e) {
			console.warn(`跳过数据：${e.message}`);
		}

	},

	async v1_1DB(c) {
		// 添加字段
		const ADD_COLUMN_SQL_LIST = [
			`ALTER TABLE email ADD COLUMN type INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE email ADD COLUMN status INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE email ADD COLUMN resend_email_id TEXT;`,
			`ALTER TABLE email ADD COLUMN message TEXT;`,

			`ALTER TABLE setting ADD COLUMN resend_tokens TEXT NOT NULL DEFAULT '{}';`,
			`ALTER TABLE setting ADD COLUMN send INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE setting ADD COLUMN r2_domain TEXT;`,
			`ALTER TABLE setting ADD COLUMN site_key TEXT;`,
			`ALTER TABLE setting ADD COLUMN secret_key TEXT;`,
			`ALTER TABLE setting ADD COLUMN background TEXT;`,
			`ALTER TABLE setting ADD COLUMN login_opacity INTEGER NOT NULL DEFAULT 0.90;`,

			`ALTER TABLE user ADD COLUMN create_ip TEXT;`,
			`ALTER TABLE user ADD COLUMN active_ip TEXT;`,
			`ALTER TABLE user ADD COLUMN os TEXT;`,
			`ALTER TABLE user ADD COLUMN browser TEXT;`,
			`ALTER TABLE user ADD COLUMN device TEXT;`,
			`ALTER TABLE user ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE user ADD COLUMN send_count INTEGER NOT NULL DEFAULT 0;`,

			`ALTER TABLE attachments ADD COLUMN status INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE attachments ADD COLUMN type INTEGER NOT NULL DEFAULT 0;`
		];

		const promises = ADD_COLUMN_SQL_LIST.map(async (sql) => {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段添加：${e.message}`);
			}
		});

		await Promise.all(promises);

		// 创建 perm 表并初始化
		await c.env.db.prepare(`
      CREATE TABLE IF NOT EXISTS perm (
        perm_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        perm_key TEXT,
        pid INTEGER NOT NULL DEFAULT 0,
        type INTEGER NOT NULL DEFAULT 2,
        sort INTEGER
      )
    `).run();

		const {permTotal} = await c.env.db.prepare(`SELECT COUNT(*) as permTotal FROM perm`).first();

		if (permTotal === 0) {
			await c.env.db.prepare(`
        INSERT INTO perm (perm_id, name, perm_key, pid, type, sort) VALUES
        (1, '邮件', NULL, 0, 0, 0),
        (2, '邮件删除', 'email:delete', 1, 2, 1),
        (3, '邮件发送', 'email:send', 1, 2, 0),
        (4, '个人设置', '', 0, 1, 2),
        (5, '用户注销', 'my:delete', 4, 2, 0),
        (6, '用户信息', NULL, 0, 1, 3),
        (7, '用户查看', 'user:query', 6, 2, 0),
        (8, '密码修改', 'user:set-pwd', 6, 2, 2),
        (9, '状态修改', 'user:set-status', 6, 2, 3),
        (10, '权限修改', 'user:set-type', 6, 2, 4),
        (11, '用户删除', 'user:delete', 6, 2, 7),
        (12, '用户收藏', 'user:star', 6, 2, 5),
        (13, '权限控制', '', 0, 1, 5),
        (14, '身份查看', 'role:query', 13, 2, 0),
        (15, '身份修改', 'role:set', 13, 2, 1),
        (16, '身份删除', 'role:delete', 13, 2, 2),
        (17, '系统设置', '', 0, 1, 6),
        (18, '设置查看', 'setting:query', 17, 2, 0),
        (19, '设置修改', 'setting:set', 17, 2, 1),
        (21, '邮箱侧栏', '', 0, 0, 1),
        (22, '邮箱查看', 'account:query', 21, 2, 0),
        (23, '邮箱添加', 'account:add', 21, 2, 1),
        (24, '邮箱删除', 'account:delete', 21, 2, 2),
        (25, '用户添加', 'user:add', 6, 2, 1),
        (26, '发件重置', 'user:reset-send', 6, 2, 6),
        (27, '邮件列表', '', 0, 1, 4),
        (28, '邮件查看', 'all-email:query', 27, 2, 0),
        (29, '邮件删除', 'all-email:delete', 27, 2, 0),
				(30, '身份添加', 'role:add', 13, 2, -1)
      `).run();
		}

		await c.env.db.prepare(`UPDATE perm SET perm_key = 'setting:clean' WHERE perm_key = 'seting:clear'`).run();
		await c.env.db.prepare(`DELETE FROM perm WHERE perm_key = 'user:star'`).run();
		// 创建 role 表并插入默认身份
		await c.env.db.prepare(`
      CREATE TABLE IF NOT EXISTS role (
        role_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        key TEXT,
        create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        sort INTEGER DEFAULT 0,
        description TEXT,
        user_id INTEGER,
        is_default INTEGER DEFAULT 0,
        send_count INTEGER,
        send_type TEXT NOT NULL DEFAULT 'count',
        account_count INTEGER
      )
    `).run();

		const { roleCount } = await c.env.db.prepare(`SELECT COUNT(*) as roleCount FROM role`).first();
		if (roleCount === 0) {
			await c.env.db.prepare(`
        INSERT INTO role (
          role_id, name, key, create_time, sort, description, user_id, is_default, send_count, send_type, account_count
        ) VALUES (
          1, '普通用户', NULL, '0000-00-00 00:00:00', 0, '只有普通使用权限', 0, 1, NULL, 'ban', 10
        )
      `).run();
		}

		// 创建 role_perm 表并初始化数据
		await c.env.db.prepare(`
      CREATE TABLE IF NOT EXISTS role_perm (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role_id INTEGER,
        perm_id INTEGER
      )
    `).run();

		const {rolePermCount} = await c.env.db.prepare(`SELECT COUNT(*) as rolePermCount FROM role_perm`).first();
		if (rolePermCount === 0) {
			await c.env.db.prepare(`
        INSERT INTO role_perm (id, role_id, perm_id) VALUES
          (100, 1, 2),
          (101, 1, 21),
          (102, 1, 22),
          (103, 1, 23),
          (104, 1, 24),
          (105, 1, 4),
          (106, 1, 5),
          (107, 1, 1),
          (108, 1, 3)
      `).run();
		}
	},

	async intDB(c) {
		// 初始化数据库表结构
		await c.env.db.prepare(`
		  CREATE TABLE IF NOT EXISTS email (
			email_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
			send_email TEXT,
			name TEXT,
			account_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			subject TEXT,
			content TEXT,
			text TEXT,
			create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
			is_del INTEGER DEFAULT 0 NOT NULL
		  )
		`).run();

		await c.env.db.prepare(`
		  CREATE TABLE IF NOT EXISTS star (
			star_id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			email_id INTEGER NOT NULL,
			create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
		  )
		`).run();

		await c.env.db.prepare(`
		  CREATE TABLE IF NOT EXISTS attachments (
			att_id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			email_id INTEGER NOT NULL,
			account_id INTEGER NOT NULL,
			key TEXT NOT NULL,
			filename TEXT,
			mime_type TEXT,
			size INTEGER,
			disposition TEXT,
			related TEXT,
			content_id TEXT,
			encoding TEXT,
			create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
		  )
		`).run();

		await c.env.db.prepare(`
		  CREATE TABLE IF NOT EXISTS user (
			user_id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL,
			type INTEGER DEFAULT 1 NOT NULL,
			password TEXT NOT NULL,
			salt TEXT NOT NULL,
			status INTEGER DEFAULT 0 NOT NULL,
			create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
			active_time DATETIME,
			is_del INTEGER DEFAULT 0 NOT NULL
		  )
		`).run();

		await c.env.db.prepare(`
		  CREATE TABLE IF NOT EXISTS account (
			account_id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL,
			status INTEGER DEFAULT 0 NOT NULL,
			latest_email_time DATETIME,
			create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
			user_id INTEGER NOT NULL,
			is_del INTEGER DEFAULT 0 NOT NULL
		  )
		`).run();

		await c.env.db.prepare(`
		  CREATE TABLE IF NOT EXISTS setting (
			register INTEGER NOT NULL,
			receive INTEGER NOT NULL,
			add_email INTEGER NOT NULL,
			many_email INTEGER NOT NULL,
			title TEXT NOT NULL,
			auto_refresh INTEGER NOT NULL,
			register_verify INTEGER NOT NULL,
			add_email_verify INTEGER NOT NULL
		  )
		`).run();

		try {
			await c.env.db.prepare(`
			  INSERT INTO setting (
				register, receive, add_email, many_email, title, auto_refresh, register_verify, add_email_verify
			  )
			  SELECT 0, 0, 0, 0, 'Cloud Mail', 0, 1, 1
			  WHERE NOT EXISTS (SELECT 1 FROM setting)
			`).run();
		} catch (e) {
			console.warn(e)
		}

	},

	async receiveEmailToRecipient(c) {

		const receiveEmailColumn = await c.env.db.prepare(`SELECT * FROM pragma_table_info('email') WHERE name = 'receive_email' limit 1`).first();

		if (!receiveEmailColumn) {
			return
		}

		const queryList = []
		const {results} = await c.env.db.prepare('SELECT receive_email,email_id FROM email').all();
		results.forEach(emailRow => {
			const recipient = {}
			recipient.address = emailRow.receive_email
			recipient.name = ''
			const recipientStr = JSON.stringify([recipient]);
			const sql = c.env.db.prepare('UPDATE email SET recipient = ? WHERE email_id = ?').bind(recipientStr,emailRow.email_id);
			queryList.push(sql)
		})

		queryList.push(c.env.db.prepare("ALTER TABLE email DROP COLUMN receive_email"));

		await c.env.db.batch(queryList);
	},


	async initAccountName(c) {

		const nameColumn = await c.env.db.prepare(`SELECT * FROM pragma_table_info('account') WHERE name = 'name' limit 1`).first();

		if (nameColumn) {
			return
		}

		const queryList = []

		queryList.push(c.env.db.prepare(`ALTER TABLE account ADD COLUMN name TEXT NOT NULL DEFAULT ''`));

		const {results} = await c.env.db.prepare(`SELECT account_id, email FROM account`).all();

		results.forEach(accountRow => {
			const name = emailUtils.getName(accountRow.email);
			const sql = c.env.db.prepare('UPDATE account SET name = ? WHERE account_id = ?').bind(name,accountRow.account_id);
			queryList.push(sql)
		})

		await c.env.db.batch(queryList);
	}
};
export { dbInit };
