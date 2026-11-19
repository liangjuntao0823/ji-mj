/* Cloudflare Pages 同域 API 代理
 * 浏览器只访问 jianli-majiang.pages.dev，/api/* 由 Pages 的 _worker.js 转发到独立 Worker，
 * 避免 workers.dev 在国内网络不可达，也避免 Pages 静态部署把 /api/* 当成 405。
 */
const API_ORIGIN = 'https://jianli-majiang-api.573395820.workers.dev';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const target = new URL(request.url);
      target.protocol = 'https:';
      target.host = new URL(API_ORIGIN).host;
      return fetch(target.toString(), request);
    }
    return env.ASSETS.fetch(request);
  },
};
