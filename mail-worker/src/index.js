import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import verifyRecordService from './service/verify-record-service';
import emailService from './service/email-service';
import kvObjService from './service/kv-obj-service';
import oauthService from "./service/oauth-service";
import analysisService from './service/analysis-service';
import tempInboxService from './service/temp-inbox-service';
import KvConst from './const/kv-const';
export default {
	 async fetch(req, env, ctx) {

		const url = new URL(req.url)

		if (url.pathname.startsWith('/api/')) {
			url.pathname = url.pathname.replace('/api', '')
			req = new Request(url.toString(), req)
			return app.fetch(req, env, ctx);
		}

		if (url.pathname.startsWith('/v1/')) {
			return app.fetch(req, env, ctx);
		}

		 if (['/static/','/attachments/'].some(p => url.pathname.startsWith(p))) {
			 return await kvObjService.toObjResp( { env }, url.pathname.substring(1));
		 }

		const response = await env.assets.fetch(req);
		if (!response.headers.get('content-type')?.includes('text/html')) return response;
		const favicon = (await env.kv.get(KvConst.SETTING, { type: 'json' }))?.favicon;
		if (!favicon) return response;
		return new HTMLRewriter().on('#site-favicon', {
			element(element) { element.setAttribute('href', favicon); }
		}).transform(response);
	},
	email: email,
	async scheduled(c, env, ctx) {

		if (c.cron === '0 * * * *') {
			await tempInboxService.cleanupExpired({ env });
			return;
		}
		if (c.cron === '*/30 * * * *') {
			await analysisService.refreshEchartsCache({ env })
			return;
		}

		await verifyRecordService.clearRecord({ env })
		await userService.resetDaySendCount({ env })
		await emailService.completeReceiveAll({ env })
		await oauthService.clearNoBindOathUser({ env })
		await analysisService.refreshEchartsCache({ env })
	},
};
