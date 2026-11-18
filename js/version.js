/* 版本号与更新记录：每次发版同步修改这里与根目录 CHANGELOG.md */
export const APP_VERSION = '1.0.0';
export const APP_RELEASED_AT = '2026-11-18';

export const APP_RELEASES = [
  {
    version: '1.0.0',
    date: '2026-11-18',
    updates: [
      '横屏网页版正式上线：单机对局、局域网联机、手机建房三种模式',
      '首页新增版本号与更新记录入口',
      '牌桌铺满屏幕，宽屏不再出现左右黑边',
      '手机竖屏锁定状态下自动横屏显示',
    ],
    fixes: [
      '修复「裸奔」被误判成「对子胡」的番型判定',
      '修复部分宽屏设备牌桌只占中间、左右留黑边的问题',
    ],
  },
];
