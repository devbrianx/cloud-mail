import KvConst from '../const/kv-const';
import setting from '../entity/setting';
import orm from '../entity/orm';
import {verifyRecordType} from '../const/entity-const';
import fileUtils from '../utils/file-utils';
import r2Service from './r2-service';
import constant from '../const/constant';
import BizError from '../error/biz-error';
import {t} from '../i18n/i18n'
import verifyRecordService from './verify-record-service';
import userContext from '../security/user-context';


function normalizeFavicon(value) {
	const favicon = typeof value === 'string' ? value.trim() : '';
	if (!favicon) return '';
	let url;
	try {
		url = new URL(favicon);
	} catch {
		throw new BizError('Favicon URL is invalid', 400);
	}
	if (!['http:', 'https:'].includes(url.protocol)) throw new BizError('Favicon URL is invalid', 400);
	return url.href;
}
const settingService = {

	async refresh(c) {
		const settingRow = await orm(c).select().from(setting).get();
		settingRow.resendTokens = JSON.parse(settingRow.resendTokens);
		settingRow.apiDomains = Array.isArray(settingRow.apiDomains) ? settingRow.apiDomains : (settingRow.apiDomains || '').split(',').filter(Boolean);
		settingRow.apiWildcardDomains = Array.isArray(settingRow.apiWildcardDomains) ? settingRow.apiWildcardDomains : (settingRow.apiWildcardDomains || '').split(',').filter(Boolean);
		c.set('setting', settingRow);
		await c.env.kv.put(KvConst.SETTING, JSON.stringify(settingRow));
	},

	async query(c) {

		if (c.get?.('setting')) {
			return c.get('setting')
		}

		const setting = await c.env.kv.get(KvConst.SETTING, { type: 'json' });

		if (!setting) {
			throw new BizError('数据库未初始化 Database not initialized.');
		}

		let domainList = c.env.domain;

		if (typeof domainList === 'string') {
			try {
				domainList = JSON.parse(domainList)
			} catch (error) {
				throw new BizError(t('notJsonDomain'));
			}
		}

		if (!Array.isArray(domainList)) {
			throw new BizError(t('noDomainVariable'));
		}

		const normalizedDomains = domainList.map(item => item.toLowerCase());
		setting.domainList = normalizedDomains.map(item => '@' + item);
		setting.apiDomains = Array.isArray(setting.apiDomains) ? setting.apiDomains : (setting.apiDomains || '').split(',').filter(Boolean);
		setting.apiWildcardDomains = Array.isArray(setting.apiWildcardDomains) ? setting.apiWildcardDomains : (setting.apiWildcardDomains || '').split(',').filter(Boolean);


		let linuxdoSwitch = c.env.linuxdo_switch;
		let projectLink = c.env.project_link;

		if (typeof linuxdoSwitch === 'string' && linuxdoSwitch === 'true') {
			linuxdoSwitch = true
		} else if (linuxdoSwitch === true) {
			linuxdoSwitch = true
		} else {
			linuxdoSwitch = false
		}

		if (typeof projectLink === 'string' && projectLink === 'false') {
			projectLink = false
		} else if (projectLink === false) {
			projectLink = false
		} else {
			projectLink = true
		}

		setting.projectLink = projectLink;

		setting.linuxdoClientId = c.env.linuxdo_client_id;
		setting.linuxdoCallbackUrl = c.env.linuxdo_callback_url;
		setting.linuxdoSwitch = linuxdoSwitch;

		setting.emailPrefixFilter = setting.emailPrefixFilter.split(",").filter(Boolean);

		c.set?.('setting', setting);
		return setting;
	},

	async get(c, showSiteKey = false) {

		const [settingRow, recordList] = await Promise.all([
			await this.query(c),
			verifyRecordService.selectListByIP(c)
		]);


		if (!showSiteKey) {
			settingRow.siteKey = settingRow.siteKey ? `${settingRow.siteKey.slice(0, 6)}******` : null;
		}

		settingRow.secretKey = settingRow.secretKey ? `${settingRow.secretKey.slice(0, 6)}******` : null;

		Object.keys(settingRow.resendTokens).forEach(key => {
			settingRow.resendTokens[key] = `${settingRow.resendTokens[key].slice(0, 12)}******`;
		});

		settingRow.s3AccessKey = settingRow.s3AccessKey ? `${settingRow.s3AccessKey.slice(0, 12)}******` : null;
		settingRow.s3SecretKey = settingRow.s3SecretKey ? `${settingRow.s3SecretKey.slice(0, 12)}******` : null;
		settingRow.tgBotToken = settingRow.tgBotToken ? `${settingRow.tgBotToken.slice(0, 20)}******` : null;
		settingRow.hasR2 = !!c.env.r2
		settingRow.hasCfEmail = !!c.env.email

		let regVerifyOpen = false
		let addVerifyOpen = false

		recordList.forEach(row => {
			if (row.type === verifyRecordType.REG) {
				regVerifyOpen = row.count >= settingRow.regVerifyCount
			}
			if (row.type === verifyRecordType.ADD) {
				addVerifyOpen = row.count >= settingRow.addVerifyCount
			}
		})

		settingRow.regVerifyOpen = regVerifyOpen
		settingRow.addVerifyOpen = addVerifyOpen

		settingRow.storageType = await r2Service.storageType(c);

		return settingRow;
	},

	async set(c, params) {
		const settingData = await this.query(c);
		let resendTokens = { ...settingData.resendTokens, ...params.resendTokens };
		Object.keys(resendTokens).forEach(domain => {
			if (!resendTokens[domain]) delete resendTokens[domain];
		});

		if (Array.isArray(params.emailPrefixFilter)) {
			params.emailPrefixFilter = params.emailPrefixFilter + '';
		}

		if (Array.isArray(params.aiCodeFilter)) {
			params.aiCodeFilter = params.aiCodeFilter + '';
		}


		if ('favicon' in params) params.favicon = normalizeFavicon(params.favicon);
		if ('apiDomains' in params) {
			if (!Array.isArray(params.apiDomains)) throw new BizError('API domains must be an array');
			const allowedDomains = new Set(settingData.domainList.map(domain => domain.slice(1)));
			const apiDomains = [...new Set(params.apiDomains.map(domain => String(domain).trim().toLowerCase()).filter(Boolean))];
			if (apiDomains.some(domain => !allowedDomains.has(domain))) throw new BizError('API domain is not configured');
			params.apiDomains = apiDomains.join(',');
		}
		if ('apiWildcardDomains' in params) {
			if (!Array.isArray(params.apiWildcardDomains)) throw new BizError('Wildcard API domains must be an array');
			const apiDomains = new Set((('apiDomains' in params ? params.apiDomains : settingData.apiDomains) || '').toString().split(',').filter(Boolean));
			const wildcardDomains = [...new Set(params.apiWildcardDomains.map(domain => String(domain).trim().toLowerCase()).filter(Boolean))];
			if (wildcardDomains.some(domain => !apiDomains.has(domain))) throw new BizError('Wildcard API domain must be enabled for API creation', 400);
			params.apiWildcardDomains = wildcardDomains.join(',');
		}

		params.resendTokens = JSON.stringify(resendTokens);
		await orm(c).update(setting).set({ ...params }).returning().get();
		await this.refresh(c);
	},

	async deleteBackground(c) {

		const { background } = await this.query(c);
		if (!background) return

		if (background.startsWith('http')) {
			await orm(c).update(setting).set({ background: '' }).run();
			await this.refresh(c)
			return;
		}

		if (background) {
			await r2Service.delete(c,background)
			await orm(c).update(setting).set({ background: '' }).run();
			await this.refresh(c)
		}
	},

	async setBackground(c, params) {

		let { background } = params

		await this.deleteBackground(c);

		if (background && !background.startsWith('http')) {

			const file = fileUtils.base64ToFile(background)

			const arrayBuffer = await file.arrayBuffer();
			background = constant.BACKGROUND_PREFIX + await fileUtils.getBuffHash(arrayBuffer) + fileUtils.getExtFileName(file.name);


			await r2Service.putObj(c, background, arrayBuffer, {
				contentType: file.type,
				cacheControl: `public, max-age=31536000, immutable`,
				contentDisposition: `inline; filename="${file.name}"`
			});

		}

		await orm(c).update(setting).set({ background }).run();
		await this.refresh(c);
		return background;
	},


	async setBlacklist(c, params) {
		const { blackSubject, blackContent, blackFrom  } = params
		await orm(c).update(setting).set({ blackSubject, blackContent, blackFrom }).run();
		await this.refresh(c);
		return this.get(c);
	},

	async websiteConfig(c) {

		const settingRow = await this.get(c, true);
		const token = await userContext.getToken(c);

		return {
			register: settingRow.register,
			title: settingRow.title,
			manyEmail: settingRow.manyEmail,
			addEmail: settingRow.addEmail,
			autoRefresh: settingRow.autoRefresh,
			addEmailVerify: settingRow.addEmailVerify,
			registerVerify: settingRow.registerVerify,
			send: settingRow.send,
			r2Domain: settingRow.r2Domain,
			siteKey: settingRow.siteKey,
			background: settingRow.background,
			favicon: settingRow.favicon,
			loginOpacity: settingRow.loginOpacity,
			domainList: settingRow.loginDomain === 1 && !token ? [] : settingRow.domainList,
			regKey: settingRow.regKey,
			regVerifyOpen: settingRow.regVerifyOpen,
			addVerifyOpen: settingRow.addVerifyOpen,
			noticeTitle: settingRow.noticeTitle,
			noticeContent: settingRow.noticeContent,
			noticeType: settingRow.noticeType,
			noticeDuration: settingRow.noticeDuration,
			noticePosition: settingRow.noticePosition,
			noticeWidth: settingRow.noticeWidth,
			noticeOffset: settingRow.noticeOffset,
			notice: settingRow.notice,
			loginDomain: settingRow.loginDomain,
			linuxdoClientId: settingRow.linuxdoClientId,
			linuxdoCallbackUrl: settingRow.linuxdoCallbackUrl,
			linuxdoSwitch: settingRow.linuxdoSwitch,
			minEmailPrefix: settingRow.minEmailPrefix,
			projectLink: settingRow.projectLink,
			apiEnabled: settingRow.apiEnabled,
			apiDomains: settingRow.apiDomains
		};
	},

};

export default settingService;
