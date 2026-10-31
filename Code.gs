/**
 * LINE AI STUDIO - ก๋วยเตี๋ยวโบราณ by เจ๊อ้น
 * Backend: Google Apps Script (V8)
 * Database: One Google Spreadsheet (multiple tabs)
 * Frontend contract: index.html calls api(action, payload) via google.script.run.
 *
 * IMPORTANT DEPLOYMENT / SECURITY NOTES
 * 1) This file is designed to live in the same Apps Script project as index.html.
 *    Keep only Code.gs and index.html in the source repository. Use clasp to push
 *    these two files into the Apps Script project.
 * 2) Apps Script Web App doPost(e) does not expose arbitrary HTTP request headers.
 *    Therefore this implementation cannot verify LINE's x-line-signature header.
 *    It checks a long random webhook query secret instead. This is only a minimum
 *    compensating control, NOT equivalent to LINE signature verification. For a
 *    public production system, put a Cloudflare Worker / Cloud Run proxy in front
 *    of Apps Script to verify x-line-signature before forwarding the webhook.
 * 3) The dashboard has no login by design, as requested. Do not deploy it as a
 *    public, unrestricted admin console without a private URL/access-control layer.
 * 4) Apps Script is synchronous and quota-limited. Webhook processing, Gemini calls,
 *    profile synchronization and broadcast are bounded. For sustained/high-volume
 *    production traffic, move webhook intake and queues to Cloud Run / Cloud Tasks.
 * 5) LINE's followers/ids API is only available to verified or premium accounts.
 *    Non-verified accounts can only manage users learned from follow/message events.
 *
 * First run:
 *   1. Run setupSystem() in the Apps Script editor and authorize permissions.
 *   2. Add Script Properties: LINE_CHANNEL_ACCESS_TOKEN, GEMINI_API_KEY, IMGBB_API_KEY.
 *      LINE_CHANNEL_SECRET may be stored for a future verified proxy; GAS itself
 *      cannot read x-line-signature from doPost(e). SPREADSHEET_ID is created by setup.
 *   3. Deploy as Web App (execute as owner; choose access suitable for your use).
 *   4. Copy the webhookUrl shown by setupSystem() and set it in LINE Developers.
 *   5. Run setupSystem() again after configuring services if needed.
 *
 * Google Apps Script project files expected:
 *   - Code.gs
 *   - index.html
 */

'use strict';

const APP = Object.freeze({
  NAME: 'LINE AI STUDIO',
  RESTAURANT: 'ก๋วยเตี๋ยวโบราณ by เจ๊อ้น',
  VERSION: '1.0.0',
  TIMEZONE: 'Asia/Bangkok',
  DEFAULT_GEMINI_MODEL: 'gemini-3.8-flash',
  GEMINI_API_BASE: 'https://generativelanguage.googleapis.com/v1beta',
  LINE_API_BASE: 'https://api.line.me',
  LINE_DATA_BASE: 'https://api-data.line.me',
  IMGBB_API: 'https://api.imgbb.com/1/upload',
  MAX_LINE_MESSAGES: 5,
  MAX_MULTICAST_USERS: 500,
  MAX_BROADCAST_BATCH: 450,
  MAX_WEBHOOK_EVENTS: 20,
  MAX_CHAT_HISTORY: 16,
  MAX_KNOWLEDGE_ITEMS: 60,
  DEFAULT_HANDOVER_MINUTES: 5,
  CACHE_SECONDS: 120,
  SETTINGS_CACHE_KEY: 'APP_SETTINGS_CACHE_V1',
  MENU_CACHE_KEY: 'MENU_CACHE_V1',
  PROMPT_CACHE_KEY: 'PROMPT_CACHE_V1'
});

/**
 * Spreadsheet schemas. New columns are appended automatically; existing data is
 * never cleared or rewritten by the initializer.
 */
const DB_SCHEMA = Object.freeze({
  SETTINGS: ['key', 'value', 'description', 'updatedAt'],
  AI_PROMPTS: ['promptId', 'name', 'systemPrompt', 'active', 'createdAt', 'updatedAt'],
  PROMPT_VERSIONS: ['versionId', 'promptId', 'name', 'systemPrompt', 'createdAt', 'createdBy'],
  KNOWLEDGE_BASE: ['knowledgeId', 'category', 'title', 'content', 'keywords', 'priority', 'active', 'updatedAt'],
  FAQ: ['faqId', 'question', 'answer', 'keywords', 'active', 'updatedAt'],
  MENU_CATEGORIES: ['categoryId', 'name', 'description', 'sortOrder', 'active', 'createdAt', 'updatedAt'],
  MENU_ITEMS: ['menuItemId', 'categoryId', 'name', 'description', 'price', 'optionsJson', 'imageUrl', 'thumbnailUrl', 'keywords', 'available', 'sortOrder', 'createdAt', 'updatedAt'],
  MENU_IMAGES: ['imageId', 'menuItemId', 'name', 'imageUrl', 'thumbnailUrl', 'deleteUrl', 'createdAt'],
  FLEX_TEMPLATES: ['templateId', 'name', 'altText', 'contentsJson', 'category', 'active', 'createdAt', 'updatedAt'],
  WELCOME_SETTINGS: ['key', 'value', 'updatedAt'],
  WELCOME_MESSAGES: ['welcomeMessageId', 'sequence', 'messageType', 'payloadJson', 'active', 'createdAt', 'updatedAt'],
  WELCOME_LOGS: ['logId', 'userId', 'eventType', 'status', 'detail', 'createdAt'],
  LINE_USERS: ['userId', 'displayName', 'pictureUrl', 'statusMessage', 'followedAt', 'lastSeenAt', 'isBlocked', 'tagsJson', 'note', 'source', 'createdAt', 'updatedAt'],
  CHAT_SESSIONS: ['userId', 'replyMode', 'assignedAgent', 'sessionStatus', 'lastMessageAt', 'waitingSince', 'deadlineAt', 'timeoutSent', 'conversationVersion', 'orderDraftJson', 'unreadCount', 'tagsJson', 'updatedAt'],
  CHAT_MESSAGES: ['messageId', 'userId', 'senderType', 'senderName', 'messageType', 'text', 'payloadJson', 'deliveryStatus', 'lineMessageId', 'createdAt'],
  ORDERS: ['orderId', 'userId', 'displayName', 'itemsJson', 'subtotal', 'total', 'fulfillmentType', 'arrivalTime', 'partySize', 'note', 'status', 'createdAt', 'confirmedAt', 'updatedAt', 'groupNotifiedAt'],
  ORDER_ITEMS: ['orderItemId', 'orderId', 'menuItemId', 'name', 'quantity', 'unitPrice', 'optionsJson', 'note'],
  ORDER_EVENTS: ['eventId', 'orderId', 'fromStatus', 'toStatus', 'actor', 'note', 'createdAt'],
  TAGS: ['tagId', 'name', 'color', 'description', 'createdAt'],
  KEYWORD_RULES: ['ruleId', 'name', 'keywords', 'matchType', 'responseType', 'responsePayloadJson', 'priority', 'active', 'createdAt', 'updatedAt'],
  AUTOMATIONS: ['automationId', 'name', 'triggerType', 'triggerValue', 'actionType', 'actionPayloadJson', 'active', 'createdAt', 'updatedAt'],
  BROADCAST: ['broadcastId', 'name', 'templateType', 'payloadJson', 'recipientMode', 'recipientCount', 'status', 'scheduledAt', 'createdAt', 'startedAt', 'completedAt', 'sentCount', 'failedCount'],
  BROADCAST_RECIPIENTS: ['recipientId', 'broadcastId', 'userId', 'status', 'error', 'sentAt'],
  STAFF_GROUPS: ['groupId', 'name', 'isDefault', 'active', 'createdAt', 'updatedAt'],
  ADMINS: ['agentId', 'agentName', 'displayName', 'active', 'createdAt', 'updatedAt'],
  HANDOVER_SETTINGS: ['key', 'value', 'updatedAt'],
  HANDOVER_QUEUE: ['handoverId', 'userId', 'requestedAt', 'deadlineAt', 'handoverStatus', 'assignedAgent', 'timeoutSent', 'lastCustomerMessageAt', 'createdAt', 'updatedAt'],
  RICH_MENUS: ['richMenuId', 'name', 'richMenuLineId', 'imageUrl', 'isDefault', 'active', 'areasJson', 'createdAt', 'updatedAt'],
  ANALYTICS: ['date', 'metric', 'value', 'updatedAt'],
  SYSTEM_LOGS: ['logId', 'level', 'module', 'message', 'detail', 'createdAt']
});

const DEFAULT_SETTINGS = Object.freeze({
  restaurantName: APP.RESTAURANT,
  restaurantPhone: '0626590910',
  timezone: APP.TIMEZONE,
  geminiModel: APP.DEFAULT_GEMINI_MODEL,
  aiEnabled: true,
  aiTemperature: 0.4,
  aiMaxOutputTokens: 700,
  aiFallbackMessage: 'ขออภัยค่ะ ตอนนี้ระบบยังตอบคำถามนี้ไม่ได้ ฝากคำถามไว้หรือพิมพ์ “ติดต่อเจ้าหน้าที่” เพื่อให้พนักงานช่วยดูแลได้เลยนะคะ',
  aiLoadingAnimation: true,
  aiLoadingSeconds: 10,
  defaultAgentName: 'Ponlabat',
  handoverEnabled: true,
  handoverTimeoutMinutes: 5,
  handoverInitialMessage: 'รับทราบค่ะ กำลังประสานเจ้าหน้าที่ให้มาดูแลนะคะ กรุณารอสักครู่ค่ะ',
  handoverTimeoutMessage: 'ขออภัย ขณะนี้ไม่มีแอดมินให้บริการ กรุณาฝากข้อความไว้ หรือโทรที่ 0626590910 ทางร้านจะติดต่อกลับโดยเร็วที่สุดค่ะ',
  handoverResumeAiAfterTimeout: true,
  handoverNotifyStaff: true,
  orderEnabled: true,
  orderRequireConfirmation: true,
  staffGroupId: '',
  welcomeEnabled: true,
  welcomeSendOnlyFirstFollow: true,
  welcomeMaxReplyMessages: 5,
  defaultOrderStatus: 'NEW',
  broadcastEnabled: true,
  publicMenuUrl: '',
  businessHours: 'ทุกวัน 08:00-17:00 น.',
  webhookSecret: '',
  currency: 'THB'
});

const DEFAULT_HANDOVER_SETTINGS = Object.freeze({
  timeoutMinutes: 5,
  enabled: true,
  resumeAiAfterTimeout: true,
  notifyStaff: true,
  initialMessage: DEFAULT_SETTINGS.handoverInitialMessage,
  timeoutMessage: DEFAULT_SETTINGS.handoverTimeoutMessage,
  acceptedMessage: 'สวัสดีครับ {{agent_name}} เป็นผู้ให้บริการในวันนี้ครับ สอบถามตรงไหนดีครับ 😊',
  returnedToAiMessage: 'ตอนนี้เจ๊อ้น AI กลับมาช่วยดูแลแล้วนะคะ สอบถามได้เลยค่ะ 😊'
});

/* -------------------------------------------------------------------------- */
/* WEB APP ENTRY POINTS                                                       */
/* -------------------------------------------------------------------------- */

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.health === '1') {
      return jsonOutput_({ ok: true, app: APP.NAME, version: APP.VERSION, time: new Date().toISOString() });
    }
    return HtmlService.createHtmlOutputFromFile('index')
      .setTitle(APP.NAME + ' | ' + APP.RESTAURANT)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
  } catch (error) {
    logError_('WEBAPP', 'doGet failed', error);
    return HtmlService.createHtmlOutput('<h2>ยังไม่พบไฟล์ index.html</h2><p>เพิ่มไฟล์ HTML ชื่อ index ใน Apps Script project ก่อน Deploy</p>');
  }
}

/** LINE webhook endpoint. Set URL to the webhookUrl returned by setupSystem() and enable Use webhook. */
function doPost(e) {
  const startedAt = Date.now();
  try {
    const props = PropertiesService.getScriptProperties();
    const expectedSecret = props.getProperty('WEBHOOK_SECRET') || '';
    const suppliedSecret = e && e.parameter ? String(e.parameter.hook || '') : '';

    if (!expectedSecret || !suppliedSecret || !constantTimeEquals_(expectedSecret, suppliedSecret)) {
      logWarn_('WEBHOOK', 'Rejected request: webhook secret mismatch.');
      return jsonOutput_({ ok: false, error: 'Unauthorized webhook' });
    }

    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const body = JSON.parse(raw);
    const events = Array.isArray(body.events) ? body.events.slice(0, APP.MAX_WEBHOOK_EVENTS) : [];
    events.forEach(function (event) {
      try {
        const eventId = event && event.webhookEventId ? String(event.webhookEventId) : '';
        const eventCache = CacheService.getScriptCache();
        if (eventId && eventCache.get('LINE_EVENT_' + eventId)) return;
        if (eventId) eventCache.put('LINE_EVENT_' + eventId, 'PROCESSING', 21600);
        processLineEvent_(event);
        if (eventId) eventCache.put('LINE_EVENT_' + eventId, 'DONE', 21600);
      } catch (eventError) {
        logError_('WEBHOOK_EVENT', 'Failed to process LINE event', eventError, { eventType: event && event.type });
      }
    });

    return jsonOutput_({ ok: true, processed: events.length, elapsedMs: Date.now() - startedAt });
  } catch (error) {
    logError_('WEBHOOK', 'doPost failed', error);
    return jsonOutput_({ ok: false, error: safeError_(error) });
  }
}

/**
 * Generic frontend API router. All Dashboard actions should use this contract:
 * google.script.run.withSuccessHandler(...).api('dashboard.get', {});
 */
function api(action, payload) {
  const data = payload || {};
  try {
    switch (String(action || '')) {
      case 'system.status': return getSystemStatus();
      case 'system.testLine': return testLineConnection();
      case 'system.testGemini': return testGeminiConnection();
      case 'system.testImgBB': return testImgBBConnection();
      case 'dashboard.get': return getDashboardData();
      case 'settings.get': return getSettings();
      case 'settings.save': return saveSettings(data);
      case 'menus.list': return getMenuItems(data);
      case 'menus.save': return saveMenuItem(data);
      case 'menus.delete': return deleteMenuItem(data.menuItemId);
      case 'categories.list': return getMenuCategories();
      case 'categories.save': return saveMenuCategory(data);
      case 'categories.delete': return deleteMenuCategory(data.categoryId);
      case 'knowledge.list': return getKnowledgeBase(data);
      case 'knowledge.save': return saveKnowledge(data);
      case 'knowledge.delete': return deleteKnowledge(data.knowledgeId);
      case 'faq.list': return getFaqs();
      case 'faq.save': return saveFaq(data);
      case 'faq.delete': return deleteFaq(data.faqId);
      case 'prompts.list': return getPrompts();
      case 'prompts.save': return savePrompt(data);
      case 'prompts.activate': return activatePrompt(data.promptId);
      case 'prompts.versions': return getPromptVersions(data.promptId);
      case 'flex.list': return getFlexTemplates(data);
      case 'flex.save': return saveFlexTemplate(data);
      case 'flex.delete': return deleteFlexTemplate(data.templateId);
      case 'flex.send': return sendFlexToUsers(data.userIds || [], data.templateId, data.contentsJson);
      case 'welcome.get': return getWelcomeConfiguration();
      case 'welcome.save': return saveWelcomeConfiguration(data);
      case 'welcome.test': return sendWelcomeTest(data.userId);
      case 'members.list': return getMembers(data);
      case 'members.sync': return syncFollowersBatch(data.limit);
      case 'members.save': return saveMember(data);
      case 'members.tag': return updateMemberTags(data);
      case 'members.profile': return getMemberProfile(data.userId);
      case 'chat.list': return getLiveChats(data);
      case 'chat.messages': return getChatMessages(data.userId, data.limit);
      case 'chat.send': return sendLiveChatMessage(data);
      case 'chat.mode': return setChatMode(data);
      case 'chat.accept': return acceptHandover(data);
      case 'chat.close': return closeChat(data);
      case 'handover.queue': return getHandoverQueue(data);
      case 'handover.settings.get': return getHandoverSettings();
      case 'handover.settings.save': return saveHandoverSettings(data);
      case 'orders.list': return getOrders(data);
      case 'orders.update': return updateOrderStatus(data);
      case 'orders.create': return createManualOrder(data);
      case 'images.upload': return uploadImageToImgBB(data);
      case 'images.list': return getUploadedImages(data);
      case 'images.delete': return deleteUploadedImage(data.imageId);
      case 'broadcast.list': return getBroadcasts(data);
      case 'broadcast.create': return createBroadcast(data);
      case 'broadcast.run': return processBroadcastQueue();
      case 'broadcast.retryFailed': return retryFailedBroadcastRecipients(data.broadcastId);
      case 'automations.list': return getAutomations();
      case 'automations.save': return saveAutomation(data);
      case 'automations.delete': return deleteAutomation(data.automationId);
      case 'keywords.list': return getKeywordRules();
      case 'keywords.save': return saveKeywordRule(data);
      case 'keywords.delete': return deleteKeywordRule(data.ruleId);
      case 'staffGroups.list': return getStaffGroups();
      case 'staffGroups.save': return saveStaffGroup(data);
      case 'staffGroups.delete': return deleteStaffGroup(data.groupId);
      case 'admins.list': return getAdmins();
      case 'admins.save': return saveAdmin(data);
      case 'admins.delete': return deleteAdmin(data.agentId);
      case 'richMenus.list': return getRichMenus();
      case 'richMenus.create': return createRichMenu(data);
      case 'richMenus.uploadImage': return uploadRichMenuImage(data);
      case 'richMenus.link': return linkRichMenuToUser(data);
      case 'richMenus.unlink': return unlinkRichMenuFromUser(data.userId);
      case 'richMenus.default': return setDefaultRichMenu(data.richMenuLineId);
      case 'richMenus.delete': return deleteRichMenu(data.richMenuLineId);
      case 'reports.get': return getReports(data);
      case 'logs.list': return getSystemLogs(data);
      default: throw new Error('ไม่รู้จัก API action: ' + action);
    }
  } catch (error) {
    logError_('API', 'API action failed: ' + action, error, data);
    return { ok: false, error: safeError_(error) };
  }
}

/* -------------------------------------------------------------------------- */
/* INITIALIZATION / DATABASE                                                  */
/* -------------------------------------------------------------------------- */

function setupSystem() {
  // Setup is an owner-run, one-time operation. Do not hold ScriptLock here:
  // seedDefaultData_ uses appendRow_ which acquires the same lock for writes.
  const props = PropertiesService.getScriptProperties();
  let spreadsheetId = props.getProperty('SPREADSHEET_ID');
  let spreadsheet;

  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) spreadsheet = SpreadsheetApp.create(APP.NAME + ' - ' + APP.RESTAURANT);
    spreadsheetId = spreadsheet.getId();
    props.setProperty('SPREADSHEET_ID', spreadsheetId);
  }

  ensureAllSheets_(spreadsheet);
  seedDefaultData_();

  if (!props.getProperty('WEBHOOK_SECRET')) {
    props.setProperty('WEBHOOK_SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  }

  // One coordinator trigger avoids duplicate timeout/broadcast workers.
  createOrReplaceTrigger_('processSystemQueues', 1);

  clearAppCaches_();
  logInfo_('SETUP', 'System initialized', { spreadsheetId: spreadsheetId, version: APP.VERSION });
  return {
    ok: true,
    message: 'สร้างฐานข้อมูลและหัวตารางเรียบร้อยแล้ว',
    spreadsheetId: spreadsheetId,
    spreadsheetUrl: spreadsheet.getUrl(),
    webhookUrl: getWebhookUrl_(),
    tabs: Object.keys(DB_SCHEMA)
  };
}

function ensureAllSheets_(spreadsheet) {
  Object.keys(DB_SCHEMA).forEach(function (sheetName) {
    let sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
    const expected = DB_SCHEMA[sheetName];
    const lastColumn = Math.max(sheet.getLastColumn(), 1);
    const existing = sheet.getLastRow() > 0 ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String) : [];
    if (existing.length === 0 || (existing.length === 1 && existing[0] === '')) {
      sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, expected.length).setFontWeight('bold').setBackground('#E8F5E9');
      return;
    }
    const missing = expected.filter(function (header) { return existing.indexOf(header) === -1; });
    if (missing.length) {
      sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
      sheet.getRange(1, existing.length + 1, 1, missing.length).setFontWeight('bold').setBackground('#E8F5E9');
    }
    sheet.setFrozenRows(1);
  });
}

function seedDefaultData_() {
  Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
    if (key === 'webhookSecret') return;
    if (getSetting_(key) === null) setSetting_(key, DEFAULT_SETTINGS[key], 'ค่าเริ่มต้นของระบบ');
  });

  Object.keys(DEFAULT_HANDOVER_SETTINGS).forEach(function (key) {
    if (getKeyValue_('HANDOVER_SETTINGS', 'key', key) === null) {
      upsertByKey_('HANDOVER_SETTINGS', 'key', key, { value: DEFAULT_HANDOVER_SETTINGS[key], updatedAt: new Date() });
    }
  });

  if (getAllRows_('AI_PROMPTS').length === 0) {
    savePrompt({
      name: 'เจ๊อ้น AI - ผู้ช่วยร้าน',
      active: true,
      systemPrompt: 'คุณคือผู้ช่วยออนไลน์ของร้านก๋วยเตี๋ยวโบราณ by เจ๊อ้น ตอบเป็นภาษาไทย สุภาพ อบอุ่น เป็นกันเอง ใช้ข้อมูลเมนู ราคา เวลาเปิดร้าน และข้อมูลที่ระบบให้เท่านั้น ห้ามคิดราคา เมนู หรือโปรโมชันขึ้นเอง หากไม่มีข้อมูลให้บอกตรง ๆ และเสนอให้ติดต่อพนักงาน หากลูกค้าต้องการเจ้าหน้าที่ให้ส่งต่อเจ้าหน้าที่ หากลูกค้าสั่งอาหาร ให้เก็บรายการ จำนวน วิธีรับประทาน เวลาเข้าร้าน จำนวนคน และหมายเหตุ แล้วสรุปให้ยืนยันก่อนสร้างออเดอร์'
    });
  }

  if (getAllRows_('MENU_CATEGORIES').length === 0) {
    saveMenuCategory({ name: 'ก๋วยเตี๋ยว', description: 'เมนูก๋วยเตี๋ยวโบราณ', sortOrder: 1, active: true });
    saveMenuCategory({ name: 'ของทานเล่น', description: 'ของทานเล่น', sortOrder: 2, active: true });
    saveMenuCategory({ name: 'เครื่องดื่ม', description: 'เครื่องดื่ม', sortOrder: 3, active: true });
  }
}

function createOrReplaceTrigger_(handlerName, minutes) {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (trigger) {
    if (trigger.getHandlerFunction() === handlerName) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger(handlerName).timeBased().everyMinutes(minutes).create();
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('ยังไม่ได้สร้างฐานข้อมูล กรุณารัน setupSystem() ก่อน');
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบ Sheet: ' + name + ' กรุณารัน setupSystem()');
  return sheet;
}

function getHeaders_(sheet) {
  const count = sheet.getLastColumn();
  if (count < 1) return [];
  return sheet.getRange(1, 1, 1, count).getValues()[0].map(String);
}

function getAllRows_(sheetName) {
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const headers = getHeaders_(sheet);
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.filter(function (row) { return row.some(function (value) { return value !== '' && value !== null; }); })
    .map(function (row) { return rowToObject_(headers, row); });
}

function rowToObject_(headers, row) {
  const obj = {};
  headers.forEach(function (header, index) { obj[header] = normalizeCell_(row[index]); });
  return obj;
}

function normalizeCell_(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function appendRow_(sheetName, object) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getSheet_(sheetName);
    const headers = getHeaders_(sheet);
    const row = headers.map(function (header) { return Object.prototype.hasOwnProperty.call(object, header) ? object[header] : ''; });
    sheet.appendRow(row);
    return sheet.getLastRow();
  } finally {
    lock.releaseLock();
  }
}

function findRowNumber_(sheetName, keyColumn, keyValue) {
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);
  const col = headers.indexOf(keyColumn) + 1;
  if (!col || sheet.getLastRow() < 2) return -1;
  const values = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(keyValue)) return i + 2;
  }
  return -1;
}

function upsertByKey_(sheetName, keyColumn, keyValue, object) {
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);
  let rowNumber = findRowNumber_(sheetName, keyColumn, keyValue);
  const rowObject = Object.assign({}, object);
  rowObject[keyColumn] = keyValue;
  const values = headers.map(function (header) { return Object.prototype.hasOwnProperty.call(rowObject, header) ? rowObject[header] : ''; });
  if (rowNumber < 0) {
    appendRow_(sheetName, rowObject);
    return true;
  }
  const existing = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const merged = headers.map(function (header, index) {
    return Object.prototype.hasOwnProperty.call(rowObject, header) ? rowObject[header] : existing[index];
  });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([merged]);
  return true;
}

function updateRowByKey_(sheetName, keyColumn, keyValue, patch) {
  const rowNumber = findRowNumber_(sheetName, keyColumn, keyValue);
  if (rowNumber < 0) return false;
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);
  const current = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const merged = headers.map(function (header, index) {
    return Object.prototype.hasOwnProperty.call(patch, header) ? patch[header] : current[index];
  });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([merged]);
  return true;
}

function deleteRowByKey_(sheetName, keyColumn, keyValue) {
  const rowNumber = findRowNumber_(sheetName, keyColumn, keyValue);
  if (rowNumber < 0) return false;
  getSheet_(sheetName).deleteRow(rowNumber);
  return true;
}

function getKeyValue_(sheetName, keyColumn, keyValue) {
  const rows = getAllRows_(sheetName);
  const found = rows.find(function (row) { return String(row[keyColumn]) === String(keyValue); });
  return found ? (found.value === undefined ? found : found.value) : null;
}

/* -------------------------------------------------------------------------- */
/* SETTINGS / SECRETS / HEALTH                                                */
/* -------------------------------------------------------------------------- */

function getSettings() {
  const rows = getAllRows_('SETTINGS');
  const settings = Object.assign({}, DEFAULT_SETTINGS);
  rows.forEach(function (row) {
    if (row.key) settings[row.key] = parseSettingValue_(row.value);
  });
  settings.hasLineToken = !!getSecret_('LINE_CHANNEL_ACCESS_TOKEN');
  settings.hasGeminiKey = !!getSecret_('GEMINI_API_KEY');
  settings.hasImgbbKey = !!getSecret_('IMGBB_API_KEY');
  settings.webhookSecretConfigured = !!getSecret_('WEBHOOK_SECRET');
  delete settings.webhookSecret;
  return settings;
}

function saveSettings(data) {
  const allowed = Object.keys(DEFAULT_SETTINGS).filter(function (key) { return key !== 'webhookSecret'; });
  allowed.forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(data, key)) setSetting_(key, data[key], 'ตั้งค่าจาก Dashboard');
  });
  clearAppCaches_();
  logInfo_('SETTINGS', 'Settings updated', { keys: Object.keys(data) });
  return { ok: true, settings: getSettings() };
}

function setSetting_(key, value, description) {
  upsertByKey_('SETTINGS', 'key', key, {
    value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    description: description || '',
    updatedAt: new Date()
  });
}

function getSetting_(key) {
  const value = getKeyValue_('SETTINGS', 'key', key);
  return value === null ? null : parseSettingValue_(value);
}

function parseSettingValue_(value) {
  if (typeof value !== 'string') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !isNaN(Number(value))) return Number(value);
  try { return JSON.parse(value); } catch (error) { return value; }
}

function getSecret_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function getWebhookUrl_() {
  const baseUrl = ScriptApp.getService().getUrl();
  if (!baseUrl) return '';
  return baseUrl + '?hook=' + encodeURIComponent(getSecret_('WEBHOOK_SECRET'));
}

function getSystemStatus() {
  const props = PropertiesService.getScriptProperties();
  const ssId = props.getProperty('SPREADSHEET_ID') || '';
  let spreadsheetUrl = '';
  if (ssId) {
    try { spreadsheetUrl = SpreadsheetApp.openById(ssId).getUrl(); } catch (error) { spreadsheetUrl = ''; }
  }
  return {
    ok: true,
    app: APP.NAME,
    restaurant: APP.RESTAURANT,
    version: APP.VERSION,
    databaseReady: !!ssId,
    spreadsheetId: ssId,
    spreadsheetUrl: spreadsheetUrl,
    lineConfigured: !!getSecret_('LINE_CHANNEL_ACCESS_TOKEN'),
    geminiConfigured: !!getSecret_('GEMINI_API_KEY'),
    imgbbConfigured: !!getSecret_('IMGBB_API_KEY'),
    webhookSecretConfigured: !!getSecret_('WEBHOOK_SECRET'),
    timezone: APP.TIMEZONE
  };
}

function testLineConnection() {
  const result = lineRequest_('GET', '/v2/bot/info', null);
  return { ok: result.ok, data: result.data, error: result.error || '' };
}

function testGeminiConnection() {
  const reply = callGemini_('ตอบคำว่า พร้อมใช้งาน เพียงคำเดียว', '', [], []);
  return { ok: true, model: getSetting_('geminiModel') || APP.DEFAULT_GEMINI_MODEL, response: reply.reply || reply.text || '' };
}

function testImgBBConnection() {
  if (!getSecret_('IMGBB_API_KEY')) throw new Error('ยังไม่ได้ตั้งค่า ImgBB API Key');
  return { ok: true, message: 'พบ ImgBB API Key แล้ว (ทดสอบ endpoint จริงด้วยการอัปโหลดภาพ)' };
}

/* -------------------------------------------------------------------------- */
/* LINE API CLIENT                                                            */
/* -------------------------------------------------------------------------- */

function lineRequest_(method, path, payload, options) {
  const token = getSecret_('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('ยังไม่ได้ตั้งค่า LINE Channel Access Token');
  const opts = options || {};
  const url = (opts.dataHost ? APP.LINE_DATA_BASE : APP.LINE_API_BASE) + path;
  const fetchOptions = {
    method: method,
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    followRedirects: true
  };
  if (payload !== null && payload !== undefined) {
    fetchOptions.contentType = opts.contentType || 'application/json';
    fetchOptions.payload = opts.raw ? payload : JSON.stringify(payload);
  }
  const response = UrlFetchApp.fetch(url, fetchOptions);
  const code = response.getResponseCode();
  const text = response.getContentText();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch (error) { parsed = { raw: text }; }
  const ok = code >= 200 && code < 300;
  if (!ok) {
    const message = parsed.message || parsed.error || text || ('LINE API HTTP ' + code);
    logError_('LINE_API', method + ' ' + path + ' failed', new Error(message), { status: code, response: parsed });
    return { ok: false, status: code, data: parsed, error: message, headers: response.getAllHeaders() };
  }
  return { ok: true, status: code, data: parsed, headers: response.getAllHeaders() };
}

function lineReply_(replyToken, messages) {
  if (!replyToken) throw new Error('ไม่มี Reply Token');
  const batch = normalizeLineMessages_(messages).slice(0, APP.MAX_LINE_MESSAGES);
  if (!batch.length) throw new Error('ไม่มีข้อความสำหรับส่ง');
  const result = lineRequest_('POST', '/v2/bot/message/reply', { replyToken: replyToken, messages: batch, notificationDisabled: false });
  if (!result.ok) throw new Error('LINE Reply ไม่สำเร็จ: ' + result.error);
  return result;
}

function linePush_(to, messages, notificationDisabled) {
  const batch = normalizeLineMessages_(messages).slice(0, APP.MAX_LINE_MESSAGES);
  if (!batch.length) throw new Error('ไม่มีข้อความสำหรับส่ง');
  const result = lineRequest_('POST', '/v2/bot/message/push', {
    to: String(to),
    messages: batch,
    notificationDisabled: !!notificationDisabled
  });
  if (!result.ok) throw new Error('LINE Push ไม่สำเร็จ: ' + result.error);
  return result;
}

function lineMulticast_(userIds, messages, notificationDisabled) {
  const ids = uniqueStrings_(userIds).slice(0, APP.MAX_MULTICAST_USERS);
  if (!ids.length) throw new Error('ไม่มีผู้รับข้อความ');
  const batch = normalizeLineMessages_(messages).slice(0, APP.MAX_LINE_MESSAGES);
  const result = lineRequest_('POST', '/v2/bot/message/multicast', {
    to: ids,
    messages: batch,
    notificationDisabled: !!notificationDisabled
  });
  if (!result.ok) throw new Error('LINE Multicast ไม่สำเร็จ: ' + result.error);
  return result;
}

function normalizeLineMessages_(messages) {
  const list = Array.isArray(messages) ? messages : [messages];
  return list.filter(Boolean).map(function (message) {
    if (typeof message === 'string') return { type: 'text', text: message };
    return message;
  });
}

function lineGetProfile_(userId) {
  const result = lineRequest_('GET', '/v2/bot/profile/' + encodeURIComponent(userId), null);
  if (!result.ok) return null;
  return result.data;
}

function lineStartLoading_(userId, seconds) {
  try {
    const duration = Math.max(5, Math.min(60, Number(seconds || 10)));
    const result = lineRequest_('POST', '/v2/bot/chat/loading/start', { chatId: userId, loadingSeconds: duration });
    return result.ok;
  } catch (error) {
    logWarn_('LINE_LOADING', 'Could not start loading animation: ' + safeError_(error));
    return false;
  }
}

function lineGetContent_(messageId) {
  const result = lineRequest_('GET', '/v2/bot/message/' + encodeURIComponent(messageId) + '/content', null, { dataHost: true });
  if (!result.ok) throw new Error('ไม่สามารถดาวน์โหลดไฟล์จาก LINE ได้: ' + result.error);
  return result;
}

/* -------------------------------------------------------------------------- */
/* WEBHOOK EVENT HANDLERS                                                     */
/* -------------------------------------------------------------------------- */

function processLineEvent_(event) {
  if (!event || !event.type) return;
  const source = event.source || {};
  const userId = source.userId || '';

  if (event.type === 'follow' && userId) return handleFollowEvent_(event);
  if (event.type === 'unfollow' && userId) return handleUnfollowEvent_(event);
  if (event.type === 'join') return handleJoinEvent_(event);
  if (event.type === 'leave') return handleLeaveEvent_(event);
  if (event.type === 'message') return handleMessageEvent_(event);
  if (event.type === 'postback') return handlePostbackEvent_(event);
}

function handleFollowEvent_(event) {
  const userId = event.source.userId;
  const existing = getMemberById_(userId);
  const isNew = !existing;
  const now = new Date();

  // Persist the friend event immediately without waiting for the profile API.
  upsertMemberFromProfile_({
    userId: userId,
    displayName: existing && existing.displayName || 'LINE User',
    pictureUrl: existing && existing.pictureUrl || ''
  }, {
    source: 'follow',
    followedAt: existing && existing.followedAt || now,
    isBlocked: false
  });
  appendWelcomeLog_(userId, 'FOLLOW', 'RECEIVED', isNew ? 'New friend' : 'Re-follow/unblock');

  const enabled = getSetting_('welcomeEnabled') !== false;
  const sendOnlyFirst = getSetting_('welcomeSendOnlyFirstFollow') !== false;
  if (enabled && !(sendOnlyFirst && !isNew)) {
    const messages = getActiveWelcomeMessages_();
    if (!messages.length) {
      const defaultText = 'ยินดีต้อนรับสู่ร้านก๋วยเตี๋ยวโบราณ by เจ๊อ้น ❤️ ขอบคุณที่เพิ่มเพื่อนนะคะ พิมพ์ถามเมนูหรือสั่งอาหารล่วงหน้าได้เลยค่ะ';
      try {
        lineReply_(event.replyToken, [{ type: 'text', text: defaultText }]);
        appendWelcomeLog_(userId, 'WELCOME', 'SENT', 'Default welcome message');
      } catch (error) {
        appendWelcomeLog_(userId, 'WELCOME', 'FAILED', safeError_(error));
        throw error;
      }
    } else {
      const replyLimit = Math.max(1, Math.min(5, Number(getSetting_('welcomeMaxReplyMessages') || 5)));
      const firstBatch = messages.slice(0, replyLimit);
      try {
        // Use the Follow event's one-time reply token first for the fastest welcome.
        lineReply_(event.replyToken, firstBatch);
        appendWelcomeLog_(userId, 'WELCOME', 'SENT', 'Sent ' + firstBatch.length + ' message(s) by reply');
      } catch (error) {
        appendWelcomeLog_(userId, 'WELCOME', 'FAILED', safeError_(error));
        throw error;
      }
      if (messages.length > firstBatch.length) {
        const remaining = messages.slice(firstBatch.length, firstBatch.length + 5);
        try {
          linePush_(userId, remaining, false);
          appendWelcomeLog_(userId, 'WELCOME_CONTINUED', 'SENT', 'Sent ' + remaining.length + ' additional message(s) by push');
        } catch (pushError) {
          appendWelcomeLog_(userId, 'WELCOME_CONTINUED', 'FAILED', safeError_(pushError));
        }
      }
    }
  }

  // Fetch display name/photo after sending the greeting so profile latency does
  // not delay the first welcome message. Profile can be unavailable for blocked
  // or privacy-restricted users; the member record is still retained by userId.
  const profile = lineGetProfile_(userId);
  if (profile) upsertMemberFromProfile_(profile, { source: 'follow', followedAt: existing && existing.followedAt || now, isBlocked: false });
}

function handleUnfollowEvent_(event) {
  const userId = event.source.userId;
  updateRowByKey_('LINE_USERS', 'userId', userId, { isBlocked: true, updatedAt: new Date() });
  const session = getChatSession_(userId);
  if (session) upsertByKey_('CHAT_SESSIONS', 'userId', userId, { sessionStatus: 'BLOCKED', replyMode: 'PAUSED', updatedAt: new Date() });
}

function handleJoinEvent_(event) {
  const groupId = event.source && (event.source.groupId || event.source.roomId);
  if (!groupId) return;
  const current = getAllRows_('STAFF_GROUPS').find(function (row) { return String(row.groupId) === String(groupId); });
  upsertByKey_('STAFF_GROUPS', 'groupId', groupId, {
    name: current ? current.name : 'LINE Group ' + groupId.slice(0, 7),
    isDefault: current ? current.isDefault : getAllRows_('STAFF_GROUPS').length === 0,
    active: true,
    createdAt: current ? current.createdAt : new Date(),
    updatedAt: new Date()
  });
  logInfo_('LINE_GROUP', 'Bot joined group', { groupId: groupId });
  if (event.replyToken) {
    try { lineReply_(event.replyToken, [{ type: 'text', text: 'เชื่อมต่อกลุ่มพนักงานเรียบร้อยแล้วค่ะ กลุ่มนี้สามารถรับแจ้งเตือนออเดอร์และคำขอเจ้าหน้าที่ได้' }]); } catch (error) { logWarn_('LINE_GROUP', safeError_(error)); }
  }
}

function handleLeaveEvent_(event) {
  const groupId = event.source && (event.source.groupId || event.source.roomId);
  if (groupId) updateRowByKey_('STAFF_GROUPS', 'groupId', groupId, { active: false, updatedAt: new Date() });
}

function handlePostbackEvent_(event) {
  const data = parseQueryString_(event.postback && event.postback.data || '');
  if (!data.action) return;
  if (data.action === 'order_status' && data.orderId && data.status) {
    updateOrderStatus({ orderId: data.orderId, status: data.status, actor: 'LINE Staff' });
    if (event.replyToken) {
      try { lineReply_(event.replyToken, [{ type: 'text', text: 'อัปเดตออเดอร์ ' + data.orderId + ' เป็น ' + data.status + ' แล้วค่ะ' }]); } catch (error) {}
    }
  }
}

function handleMessageEvent_(event) {
  const source = event.source || {};
  const userId = source.userId || '';
  const message = event.message || {};
  if (!userId) {
    if (source.groupId || source.roomId) handleStaffGroupMessage_(event);
    return;
  }

  const profile = lineGetProfile_(userId) || { userId: userId, displayName: 'LINE User' };
  upsertMemberFromProfile_(profile, { source: 'message' });
  const text = message.type === 'text' ? String(message.text || '').trim() : '';
  const payload = message.type === 'text' ? {} : { lineMessageId: message.id, contentProvider: message.contentProvider || {} };
  appendChatMessage_(userId, 'USER', profile.displayName || 'ลูกค้า', message.type || 'unknown', text, payload, 'RECEIVED');
  updateSessionActivity_(userId, 1);
  incrementMetric_('messages_received', 1);

  const session = getChatSession_(userId) || createChatSession_(userId);
  if (session.replyMode === 'HUMAN' || session.replyMode === 'PAUSED' || session.replyMode === 'CLOSED') {
    return;
  }
  if (session.replyMode === 'WAITING') {
    updateRowByKey_('HANDOVER_QUEUE', 'handoverId', getPendingHandoverId_(userId), { lastCustomerMessageAt: new Date(), updatedAt: new Date() });
    return;
  }
  if (message.type !== 'text') {
    const nonTextReply = 'ได้รับข้อความแล้วค่ะ หากต้องการสอบถามเมนูหรือสั่งอาหาร พิมพ์รายละเอียดเป็นข้อความได้เลยนะคะ';
    if (event.replyToken) lineReply_(event.replyToken, [{ type: 'text', text: nonTextReply }]);
    appendChatMessage_(userId, 'AI', APP.RESTAURANT, 'text', nonTextReply, {}, 'SENT');
    return;
  }

  const keywordResult = matchKeywordRule_(text);
  if (keywordResult) {
    sendRuleResponse_(event, userId, keywordResult);
    return;
  }
  const automationResult = runMessageAutomations_(event, userId, text);
  if (automationResult && automationResult.stopProcessing) return;

  if (containsHandoverIntent_(text)) {
    beginHandover_(userId, event.replyToken, 'Customer requested human agent');
    return;
  }

  if (getSetting_('aiEnabled') === false) {
    const disabledText = getSetting_('aiFallbackMessage') || DEFAULT_SETTINGS.aiFallbackMessage;
    if (event.replyToken) lineReply_(event.replyToken, [{ type: 'text', text: disabledText }]);
    appendChatMessage_(userId, 'AI', APP.RESTAURANT, 'text', disabledText, {}, 'SENT');
    return;
  }

  if (getSetting_('aiLoadingAnimation') !== false) {
    lineStartLoading_(userId, getSetting_('aiLoadingSeconds') || 10);
  }

  let result;
  try {
    result = processAiMessage_(userId, text);
  } catch (aiError) {
    logError_('GEMINI', 'AI processing failed; using fallback reply', aiError, { userId: userId });
    result = {
      reply: getSetting_('aiFallbackMessage') || DEFAULT_SETTINGS.aiFallbackMessage,
      handoverRequested: false,
      menuItems: [],
      conversationVersion: Number((getChatSession_(userId) || {}).conversationVersion || 0)
    };
  }
  // Discard stale AI output if a staff member changed the mode or another
  // inbound message superseded this generation while Gemini was working.
  const latestSession = getChatSession_(userId);
  if (!latestSession || latestSession.replyMode !== 'AI' || Number(latestSession.conversationVersion || 0) !== Number(result.conversationVersion || 0)) {
    return;
  }
  if (result.handoverRequested) {
    beginHandover_(userId, event.replyToken, 'AI detected handover request', result.reply);
    return;
  }

  const outbound = [];
  if (result.reply) outbound.push({ type: 'text', text: result.reply });
  (result.menuItems || []).slice(0, 3).forEach(function (item) {
    if (item.imageUrl && isHttpsUrl_(item.imageUrl)) {
      outbound.push({ type: 'image', originalContentUrl: item.imageUrl, previewImageUrl: isHttpsUrl_(item.thumbnailUrl) ? item.thumbnailUrl : item.imageUrl });
    }
  });
  const safeMessages = outbound.length ? outbound.slice(0, 5) : [{ type: 'text', text: getSetting_('aiFallbackMessage') || DEFAULT_SETTINGS.aiFallbackMessage }];
  if (event.replyToken) {
    lineReply_(event.replyToken, safeMessages);
  } else {
    linePush_(userId, safeMessages, false);
  }
  safeMessages.forEach(function (outgoing) {
    appendChatMessage_(userId, 'AI', APP.RESTAURANT, outgoing.type, outgoing.text || '', outgoing, 'SENT');
  });
  incrementMetric_('ai_replies', 1);
}

function handleStaffGroupMessage_(event) {
  const source = event.source || {};
  const groupId = source.groupId || source.roomId;
  const text = event.message && event.message.type === 'text' ? event.message.text : '';
  const match = String(text || '').match(/^\/setstaff\s+(.+)$/i);
  if (match) {
    upsertByKey_('STAFF_GROUPS', 'groupId', groupId, { name: match[1].trim(), active: true, updatedAt: new Date() });
    if (event.replyToken) lineReply_(event.replyToken, [{ type: 'text', text: 'ตั้งชื่อกลุ่มพนักงานเป็น ' + match[1].trim() + ' แล้วค่ะ' }]);
  }
}

/* -------------------------------------------------------------------------- */
/* MEMBER MANAGEMENT                                                          */
/* -------------------------------------------------------------------------- */

function getMemberById_(userId) {
  const rows = getAllRows_('LINE_USERS');
  return rows.find(function (row) { return String(row.userId) === String(userId); }) || null;
}

function upsertMemberFromProfile_(profile, extra) {
  const userId = profile.userId;
  const existing = getMemberById_(userId) || {};
  const data = Object.assign({
    displayName: profile.displayName || existing.displayName || 'LINE User',
    pictureUrl: profile.pictureUrl || existing.pictureUrl || '',
    statusMessage: profile.statusMessage || existing.statusMessage || '',
    followedAt: existing.followedAt || '',
    lastSeenAt: new Date(),
    isBlocked: false,
    tagsJson: existing.tagsJson || '[]',
    note: existing.note || '',
    source: (extra && extra.source) || existing.source || 'unknown',
    createdAt: existing.createdAt || new Date(),
    updatedAt: new Date()
  }, extra || {});
  upsertByKey_('LINE_USERS', 'userId', userId, data);
  return data;
}

function getMembers(options) {
  const opts = options || {};
  const limit = Math.min(500, Math.max(1, Number(opts.limit || 100)));
  const query = String(opts.query || '').toLowerCase();
  const tag = String(opts.tag || '');
  const rows = getAllRows_('LINE_USERS').filter(function (row) {
    if (row.isBlocked === true || String(row.isBlocked) === 'true') return false;
    if (query && (String(row.displayName || '').toLowerCase().indexOf(query) === -1 && String(row.userId || '').toLowerCase().indexOf(query) === -1)) return false;
    if (tag) {
      const tags = parseJson_(row.tagsJson, []);
      if (tags.indexOf(tag) === -1) return false;
    }
    return true;
  }).sort(function (a, b) { return new Date(b.lastSeenAt || b.followedAt || 0) - new Date(a.lastSeenAt || a.followedAt || 0); });
  return { ok: true, total: rows.length, members: rows.slice(0, limit), nextOffset: rows.length > limit ? limit : null };
}

function syncFollowersBatch(limit) {
  const pageSize = Math.min(100, Math.max(1, Number(limit || 40)));
  const cursor = getSecret_('FOLLOWERS_CURSOR');
  let path = '/v2/bot/followers/ids?limit=' + pageSize;
  if (cursor) path += '&start=' + encodeURIComponent(cursor);
  const result = lineRequest_('GET', path, null);
  if (!result.ok) {
    return { ok: false, error: result.error, hint: 'การดึงรายชื่อเพื่อนทั้งหมดใช้ได้เฉพาะ LINE OA บัญชี Verified หรือ Premium; ระบบยังเก็บเพื่อนจาก Follow/Webhook ได้' };
  }
  const userIds = result.data.userIds || [];
  let imported = 0;
  userIds.forEach(function (userId) {
    const profile = lineGetProfile_(userId);
    if (profile) {
      upsertMemberFromProfile_(profile, { source: 'followers_api' });
      imported++;
    } else {
      upsertMemberFromProfile_({ userId: userId, displayName: 'LINE User' }, { source: 'followers_api' });
    }
  });
  if (result.data.next) PropertiesService.getScriptProperties().setProperty('FOLLOWERS_CURSOR', result.data.next);
  else PropertiesService.getScriptProperties().deleteProperty('FOLLOWERS_CURSOR');
  return { ok: true, received: userIds.length, imported: imported, hasMore: !!result.data.next, message: result.data.next ? 'ยังมีรายชื่อเพื่อนส่วนถัดไป กด Sync อีกครั้ง' : 'Sync รายชื่อเพื่อนครบแล้ว' };
}

function saveMember(data) {
  if (!data.userId) throw new Error('ต้องระบุ LINE User ID');
  const existing = getMemberById_(data.userId) || {};
  upsertByKey_('LINE_USERS', 'userId', data.userId, {
    displayName: data.displayName !== undefined ? data.displayName : existing.displayName,
    note: data.note !== undefined ? data.note : existing.note,
    tagsJson: data.tags !== undefined ? JSON.stringify(uniqueStrings_(data.tags)) : (existing.tagsJson || '[]'),
    updatedAt: new Date()
  });
  return { ok: true, member: getMemberById_(data.userId) };
}

function updateMemberTags(data) {
  const member = getMemberById_(data.userId);
  if (!member) throw new Error('ไม่พบสมาชิก');
  const tags = uniqueStrings_(data.tags || []);
  updateRowByKey_('LINE_USERS', 'userId', data.userId, { tagsJson: JSON.stringify(tags), updatedAt: new Date() });
  return { ok: true, tags: tags };
}

function getMemberProfile(userId) {
  const profile = lineGetProfile_(userId);
  if (profile) upsertMemberFromProfile_(profile, { source: 'profile_api' });
  return { ok: !!profile, profile: profile, stored: getMemberById_(userId) };
}

/* -------------------------------------------------------------------------- */
/* WELCOME MESSAGE BUILDER                                                    */
/* -------------------------------------------------------------------------- */

function getWelcomeConfiguration() {
  const messages = getAllRows_('WELCOME_MESSAGES').sort(function (a, b) { return Number(a.sequence || 0) - Number(b.sequence || 0); });
  return { ok: true, settings: {
    enabled: getSetting_('welcomeEnabled') !== false,
    sendOnlyFirstFollow: getSetting_('welcomeSendOnlyFirstFollow') !== false,
    maxReplyMessages: getSetting_('welcomeMaxReplyMessages') || 5
  }, messages: messages.map(function (row) { return Object.assign({}, row, { payload: parseJson_(row.payloadJson, {}) }); }) };
}

function saveWelcomeConfiguration(data) {
  if (data.settings) {
    saveSettings({
      welcomeEnabled: data.settings.enabled,
      welcomeSendOnlyFirstFollow: data.settings.sendOnlyFirstFollow,
      welcomeMaxReplyMessages: data.settings.maxReplyMessages || 5
    });
  }
  if (Array.isArray(data.messages)) {
    const existing = getAllRows_('WELCOME_MESSAGES');
    const incomingIds = [];
    data.messages.forEach(function (item, index) {
      const id = item.welcomeMessageId || Utilities.getUuid();
      incomingIds.push(id);
      const payload = item.payload || parseJson_(item.payloadJson, {});
      validateLineMessage_(payload);
      upsertByKey_('WELCOME_MESSAGES', 'welcomeMessageId', id, {
        sequence: Number(item.sequence || index + 1),
        messageType: item.messageType || payload.type,
        payloadJson: JSON.stringify(payload),
        active: item.active !== false,
        createdAt: item.createdAt || new Date(),
        updatedAt: new Date()
      });
    });
    existing.forEach(function (row) {
      if (incomingIds.indexOf(String(row.welcomeMessageId)) === -1) deleteRowByKey_('WELCOME_MESSAGES', 'welcomeMessageId', row.welcomeMessageId);
    });
  }
  return getWelcomeConfiguration();
}

function getActiveWelcomeMessages_() {
  return getAllRows_('WELCOME_MESSAGES').filter(function (row) { return row.active === true || String(row.active) === 'true'; })
    .sort(function (a, b) { return Number(a.sequence || 0) - Number(b.sequence || 0); })
    .map(function (row) { return parseJson_(row.payloadJson, {}); })
    .filter(function (message) { return !!message.type; });
}

function appendWelcomeLog_(userId, eventType, status, detail) {
  appendRow_('WELCOME_LOGS', { logId: Utilities.getUuid(), userId: userId, eventType: eventType, status: status, detail: String(detail || ''), createdAt: new Date() });
}

function sendWelcomeTest(userId) {
  if (!userId) throw new Error('กรุณาระบุ LINE User ID สำหรับทดสอบ');
  const messages = getActiveWelcomeMessages_();
  if (!messages.length) throw new Error('ยังไม่มีข้อความต้อนรับที่เปิดใช้งาน');
  linePush_(userId, messages.slice(0, 5), false);
  appendWelcomeLog_(userId, 'WELCOME_TEST', 'SENT', messages.length + ' message(s)');
  return { ok: true, sent: Math.min(messages.length, 5) };
}

/* -------------------------------------------------------------------------- */
/* FLEX MESSAGE TEMPLATES                                                     */
/* -------------------------------------------------------------------------- */

function getFlexTemplates(options) {
  const rows = getAllRows_('FLEX_TEMPLATES');
  const filtered = options && options.activeOnly ? rows.filter(function (row) { return row.active === true || String(row.active) === 'true'; }) : rows;
  return { ok: true, templates: filtered.map(function (row) { return Object.assign({}, row, { contents: parseJson_(row.contentsJson, {}) }); }) };
}

function saveFlexTemplate(data) {
  const templateId = data.templateId || Utilities.getUuid();
  const contents = data.contents || parseJson_(data.contentsJson, {});
  validateFlexContents_(contents);
  upsertByKey_('FLEX_TEMPLATES', 'templateId', templateId, {
    name: String(data.name || 'Flex Message'),
    altText: String(data.altText || data.name || 'ข้อความจากร้านก๋วยเตี๋ยวโบราณ by เจ๊อ้น').slice(0, 400),
    contentsJson: JSON.stringify(contents),
    category: data.category || 'GENERAL',
    active: data.active !== false,
    createdAt: data.createdAt || new Date(),
    updatedAt: new Date()
  });
  return { ok: true, templateId: templateId };
}

function deleteFlexTemplate(templateId) {
  return { ok: deleteRowByKey_('FLEX_TEMPLATES', 'templateId', templateId) };
}

function sendFlexToUsers(userIds, templateId, contentsJson) {
  const ids = uniqueStrings_(userIds);
  if (!ids.length) throw new Error('กรุณาเลือกสมาชิกอย่างน้อย 1 คน');
  let contents = contentsJson ? parseJson_(contentsJson, contentsJson) : null;
  let altText = 'ข้อความจาก ' + APP.RESTAURANT;
  if (!contents && templateId) {
    const template = getAllRows_('FLEX_TEMPLATES').find(function (row) { return String(row.templateId) === String(templateId); });
    if (!template) throw new Error('ไม่พบ Flex Template');
    contents = parseJson_(template.contentsJson, {});
    altText = template.altText || altText;
  }
  validateFlexContents_(contents);
  const message = { type: 'flex', altText: altText, contents: contents };
  let success = 0;
  const errors = [];
  for (let i = 0; i < ids.length; i += APP.MAX_MULTICAST_USERS) {
    const batch = ids.slice(i, i + APP.MAX_MULTICAST_USERS);
    try {
      lineMulticast_(batch, [message], false);
      success += batch.length;
      batch.forEach(function (id) { logFlexDelivery_(id, templateId || 'CUSTOM', 'SENT', 'multicast'); });
    } catch (error) {
      errors.push({ userIds: batch, error: safeError_(error) });
      batch.forEach(function (id) { logFlexDelivery_(id, templateId || 'CUSTOM', 'FAILED', safeError_(error)); });
    }
  }
  return { ok: errors.length === 0, selected: ids.length, sent: success, failed: ids.length - success, errors: errors };
}

function logFlexDelivery_(userId, templateId, status, detail) {
  appendRow_('WELCOME_LOGS', { logId: Utilities.getUuid(), userId: userId, eventType: 'FLEX_' + templateId, status: status, detail: detail, createdAt: new Date() });
}

function validateFlexContents_(contents) {
  if (!contents || (contents.type !== 'bubble' && contents.type !== 'carousel')) throw new Error('Flex contents ต้องมี type เป็น bubble หรือ carousel');
  const json = JSON.stringify(contents);
  if (json.length > 50000) throw new Error('Flex Message มีขนาดใหญ่เกินไป');
  return true;
}

function validateLineMessage_(message) {
  if (!message || !message.type) throw new Error('รูปแบบข้อความ LINE ไม่ถูกต้อง');
  if (message.type === 'flex') validateFlexContents_(message.contents);
  if (message.type === 'text' && !message.text) throw new Error('Text Message ต้องมีข้อความ');
  return true;
}

/* -------------------------------------------------------------------------- */
/* MENU / CATEGORY MANAGEMENT                                                 */
/* -------------------------------------------------------------------------- */

function getMenuCategories() {
  const rows = getAllRows_('MENU_CATEGORIES').filter(function (row) { return row.active !== false && String(row.active) !== 'false'; });
  rows.sort(function (a, b) { return Number(a.sortOrder || 0) - Number(b.sortOrder || 0); });
  return { ok: true, categories: rows };
}

function saveMenuCategory(data) {
  const id = data.categoryId || Utilities.getUuid();
  upsertByKey_('MENU_CATEGORIES', 'categoryId', id, {
    name: String(data.name || '').trim(),
    description: data.description || '',
    sortOrder: Number(data.sortOrder || 0),
    active: data.active !== false,
    createdAt: data.createdAt || new Date(),
    updatedAt: new Date()
  });
  clearAppCaches_();
  return { ok: true, categoryId: id };
}

function deleteMenuCategory(categoryId) {
  const hasItems = getAllRows_('MENU_ITEMS').some(function (item) { return String(item.categoryId) === String(categoryId); });
  if (hasItems) throw new Error('หมวดหมู่นี้มีเมนูอาหารอยู่ กรุณาย้ายหรือลบเมนูก่อน');
  return { ok: deleteRowByKey_('MENU_CATEGORIES', 'categoryId', categoryId) };
}

function getMenuItems(options) {
  const opts = options || {};
  let rows = getAllRows_('MENU_ITEMS');
  if (opts.availableOnly) rows = rows.filter(function (row) { return row.available === true || String(row.available) === 'true'; });
  if (opts.categoryId) rows = rows.filter(function (row) { return String(row.categoryId) === String(opts.categoryId); });
  if (opts.query) {
    const query = String(opts.query).toLowerCase();
    rows = rows.filter(function (row) { return [row.name, row.description, row.keywords].join(' ').toLowerCase().indexOf(query) !== -1; });
  }
  rows.sort(function (a, b) { return Number(a.sortOrder || 0) - Number(b.sortOrder || 0); });
  return { ok: true, items: rows.map(function (row) { return Object.assign({}, row, { options: parseJson_(row.optionsJson, []) }); }) };
}

function saveMenuItem(data) {
  const id = data.menuItemId || Utilities.getUuid();
  const price = Number(data.price || 0);
  if (!String(data.name || '').trim()) throw new Error('กรุณาระบุชื่ออาหาร');
  if (price < 0 || !isFinite(price)) throw new Error('ราคาไม่ถูกต้อง');
  upsertByKey_('MENU_ITEMS', 'menuItemId', id, {
    categoryId: data.categoryId || '',
    name: String(data.name).trim(),
    description: data.description || '',
    price: price,
    optionsJson: JSON.stringify(data.options || parseJson_(data.optionsJson, [])),
    imageUrl: data.imageUrl || '',
    thumbnailUrl: data.thumbnailUrl || data.imageUrl || '',
    keywords: data.keywords || '',
    available: data.available !== false,
    sortOrder: Number(data.sortOrder || 0),
    createdAt: data.createdAt || new Date(),
    updatedAt: new Date()
  });
  clearAppCaches_();
  return { ok: true, menuItemId: id };
}

function deleteMenuItem(menuItemId) {
  getAllRows_('MENU_IMAGES').filter(function (row) { return String(row.menuItemId) === String(menuItemId); }).forEach(function (row) { deleteRowByKey_('MENU_IMAGES', 'imageId', row.imageId); });
  clearAppCaches_();
  return { ok: deleteRowByKey_('MENU_ITEMS', 'menuItemId', menuItemId) };
}

/* -------------------------------------------------------------------------- */
/* IMAGE UPLOAD - IMGBB                                                       */
/* -------------------------------------------------------------------------- */

function uploadImageToImgBB(data) {
  const apiKey = getSecret_('IMGBB_API_KEY');
  if (!apiKey) throw new Error('ยังไม่ได้ตั้งค่า ImgBB API Key');
  const base64 = String(data.base64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!base64) throw new Error('ไม่พบข้อมูลรูปภาพ');
  if (base64.length > 12 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกินไป (จำกัดข้อมูล Base64 ประมาณ 12 MB)');
  const response = UrlFetchApp.fetch(APP.IMGBB_API + '?key=' + encodeURIComponent(apiKey), {
    method: 'post',
    payload: { image: base64, name: data.name || 'menu-' + Date.now() },
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const result = parseJson_(response.getContentText(), {});
  if (code < 200 || code >= 300 || !result.success) throw new Error('ImgBB Upload ไม่สำเร็จ: ' + (result.error && result.error.message || response.getContentText()));
  const image = result.data || {};
  const record = {
    imageId: Utilities.getUuid(),
    menuItemId: data.menuItemId || '',
    name: data.name || image.title || 'uploaded-image',
    imageUrl: image.url || image.display_url || '',
    thumbnailUrl: image.thumb && image.thumb.url || image.medium && image.medium.url || image.url || '',
    deleteUrl: image.delete_url || '',
    createdAt: new Date()
  };
  appendRow_('MENU_IMAGES', record);
  if (data.menuItemId) {
    updateRowByKey_('MENU_ITEMS', 'menuItemId', data.menuItemId, { imageUrl: record.imageUrl, thumbnailUrl: record.thumbnailUrl, updatedAt: new Date() });
  }
  return { ok: true, image: record };
}

function getUploadedImages(options) {
  const opts = options || {};
  let images = getAllRows_('MENU_IMAGES').sort(function (a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
  if (opts.menuItemId) images = images.filter(function (row) { return String(row.menuItemId) === String(opts.menuItemId); });
  return { ok: true, images: images.slice(0, Math.min(500, Number(opts.limit || 200))) };
}

function deleteUploadedImage(imageId) {
  const row = getAllRows_('MENU_IMAGES').find(function (item) { return String(item.imageId) === String(imageId); });
  if (!row) return { ok: false, error: 'ไม่พบรูปภาพ' };
  const removed = deleteRowByKey_('MENU_IMAGES', 'imageId', imageId);
  if (row.menuItemId) {
    const menu = getAllRows_('MENU_ITEMS').find(function (item) { return String(item.menuItemId) === String(row.menuItemId); });
    if (menu && String(menu.imageUrl) === String(row.imageUrl)) {
      updateRowByKey_('MENU_ITEMS', 'menuItemId', row.menuItemId, { imageUrl: '', thumbnailUrl: '', updatedAt: new Date() });
    }
  }
  return { ok: removed };
}

/* -------------------------------------------------------------------------- */
/* AI PROMPTS / KNOWLEDGE / FAQ                                               */
/* -------------------------------------------------------------------------- */

function getPrompts() {
  const prompts = getAllRows_('AI_PROMPTS');
  return { ok: true, prompts: prompts, activePrompt: prompts.find(function (row) { return row.active === true || String(row.active) === 'true'; }) || null };
}

function savePrompt(data) {
  const id = data.promptId || Utilities.getUuid();
  const text = String(data.systemPrompt || '').trim();
  if (!text) throw new Error('System Prompt ต้องไม่ว่าง');
  const existing = getAllRows_('AI_PROMPTS').find(function (row) { return String(row.promptId) === String(id); });
  if (existing && String(existing.systemPrompt) !== text) {
    appendRow_('PROMPT_VERSIONS', { versionId: Utilities.getUuid(), promptId: id, name: existing.name, systemPrompt: existing.systemPrompt, createdAt: new Date(), createdBy: 'Dashboard' });
  }
  const makeActive = data.active === true || !getAllRows_('AI_PROMPTS').length;
  if (makeActive) getAllRows_('AI_PROMPTS').forEach(function (row) { updateRowByKey_('AI_PROMPTS', 'promptId', row.promptId, { active: false }); });
  upsertByKey_('AI_PROMPTS', 'promptId', id, {
    name: data.name || 'AI Prompt',
    systemPrompt: text,
    active: makeActive,
    createdAt: data.createdAt || new Date(),
    updatedAt: new Date()
  });
  clearAppCaches_();
  return { ok: true, promptId: id };
}

function activatePrompt(promptId) {
  const prompts = getAllRows_('AI_PROMPTS');
  let found = false;
  prompts.forEach(function (row) {
    const active = String(row.promptId) === String(promptId);
    if (active) found = true;
    updateRowByKey_('AI_PROMPTS', 'promptId', row.promptId, { active: active, updatedAt: new Date() });
  });
  if (!found) throw new Error('ไม่พบ Prompt');
  clearAppCaches_();
  return { ok: true };
}

function getPromptVersions(promptId) {
  return { ok: true, versions: getAllRows_('PROMPT_VERSIONS').filter(function (row) { return String(row.promptId) === String(promptId); }) };
}

function getActivePrompt_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(APP.PROMPT_CACHE_KEY);
  if (cached) return parseJson_(cached, {});
  const prompt = getAllRows_('AI_PROMPTS').find(function (row) { return row.active === true || String(row.active) === 'true'; });
  const result = prompt || { systemPrompt: 'คุณคือผู้ช่วยของร้านก๋วยเตี๋ยวโบราณ by เจ๊อ้น ตอบภาษาไทยอย่างสุภาพและเป็นกันเอง' };
  cache.put(APP.PROMPT_CACHE_KEY, JSON.stringify(result), APP.CACHE_SECONDS);
  return result;
}

function getKnowledgeBase(options) {
  const opts = options || {};
  let rows = getAllRows_('KNOWLEDGE_BASE');
  if (opts.activeOnly) rows = rows.filter(function (row) { return row.active === true || String(row.active) === 'true'; });
  if (opts.query) {
    const q = String(opts.query).toLowerCase();
    rows = rows.filter(function (row) { return [row.category, row.title, row.content, row.keywords].join(' ').toLowerCase().indexOf(q) >= 0; });
  }
  return { ok: true, knowledge: rows };
}

function saveKnowledge(data) {
  const id = data.knowledgeId || Utilities.getUuid();
  upsertByKey_('KNOWLEDGE_BASE', 'knowledgeId', id, {
    category: data.category || 'ทั่วไป',
    title: data.title || '',
    content: data.content || '',
    keywords: data.keywords || '',
    priority: Number(data.priority || 0),
    active: data.active !== false,
    updatedAt: new Date()
  });
  clearAppCaches_();
  return { ok: true, knowledgeId: id };
}

function deleteKnowledge(knowledgeId) {
  clearAppCaches_();
  return { ok: deleteRowByKey_('KNOWLEDGE_BASE', 'knowledgeId', knowledgeId) };
}

function getFaqs() { return { ok: true, faqs: getAllRows_('FAQ') }; }

function saveFaq(data) {
  const id = data.faqId || Utilities.getUuid();
  upsertByKey_('FAQ', 'faqId', id, {
    question: data.question || '', answer: data.answer || '', keywords: data.keywords || '',
    active: data.active !== false, updatedAt: new Date()
  });
  return { ok: true, faqId: id };
}

function deleteFaq(faqId) { return { ok: deleteRowByKey_('FAQ', 'faqId', faqId) }; }

/* -------------------------------------------------------------------------- */
/* GEMINI CHAT / STRUCTURED ORDER EXTRACTION                                  */
/* -------------------------------------------------------------------------- */

function processAiMessage_(userId, text) {
  const session = getChatSession_(userId) || createChatSession_(userId);
  const history = getChatMessages(userId, APP.MAX_CHAT_HISTORY).messages || [];
  const menu = getMenuItems({ availableOnly: true }).items;
  const knowledge = selectRelevantKnowledge_(text, APP.MAX_KNOWLEDGE_ITEMS);
  const prompt = getActivePrompt_();
  const draft = parseJson_(session.orderDraftJson, null);
  const versionAtStart = Number(session.conversationVersion || 0);
  const modelResult = callGemini_(text, prompt.systemPrompt || '', history, menu, knowledge, draft);
  const normalized = normalizeAiResult_(modelResult);
  normalized.conversationVersion = versionAtStart;

  if (normalized.handoverRequested) return normalized;

  let menuItems = [];
  const menuIds = uniqueStrings_(normalized.menuItemIds || []);
  if (menuIds.length) menuItems = menu.filter(function (item) { return menuIds.indexOf(String(item.menuItemId)) >= 0; });

  if (normalized.order && normalized.order.items && normalized.order.items.length) {
    const newDraft = mergeAndValidateOrderDraft_(draft, normalized.order, menu);
    if (newDraft) {
      const messageIsConfirmation = draft && draft.stage === 'AWAIT_CONFIRM' && isPositiveConfirmation_(text);
      if (messageIsConfirmation) {
        const order = createOrderFromDraft_(userId, newDraft);
        upsertByKey_('CHAT_SESSIONS', 'userId', userId, { orderDraftJson: '', updatedAt: new Date() });
        normalized.reply = 'ยืนยันออเดอร์เรียบร้อยแล้วค่ะ เลขที่ออเดอร์ ' + order.orderId + ' ทางร้านได้รับรายการแล้วนะคะ ❤️';
      } else {
        const missing = getMissingOrderFields_(newDraft);
        if (missing.length) {
          newDraft.stage = 'COLLECTING';
          normalized.reply = orderQuestion_(missing[0], newDraft);
        } else {
          newDraft.stage = 'AWAIT_CONFIRM';
          normalized.reply = buildOrderSummary_(newDraft) + '\n\nถูกต้องไหมคะ? หากถูกต้องพิมพ์ “ยืนยันออเดอร์” ได้เลยค่ะ';
        }
        upsertByKey_('CHAT_SESSIONS', 'userId', userId, { orderDraftJson: JSON.stringify(newDraft), updatedAt: new Date() });
      }
    }
  } else if (draft && draft.stage === 'AWAIT_CONFIRM' && isPositiveConfirmation_(text)) {
    const order = createOrderFromDraft_(userId, draft);
    upsertByKey_('CHAT_SESSIONS', 'userId', userId, { orderDraftJson: '', updatedAt: new Date() });
    normalized.reply = 'ยืนยันออเดอร์เรียบร้อยแล้วค่ะ เลขที่ออเดอร์ ' + order.orderId + ' ทางร้านได้รับรายการแล้วนะคะ ❤️';
  }

  normalized.menuItems = menuItems;
  return normalized;
}

function callGemini_(userText, systemPrompt, history, menuItems, knowledgeItems, orderDraft) {
  const apiKey = getSecret_('GEMINI_API_KEY');
  if (!apiKey) throw new Error('ยังไม่ได้ตั้งค่า Gemini API Key');
  const model = String(getSetting_('geminiModel') || APP.DEFAULT_GEMINI_MODEL);
  const menuSummary = (menuItems || []).slice(0, 100).map(function (item) {
    return { id: item.menuItemId, name: item.name, description: item.description, price: Number(item.price || 0), keywords: item.keywords || '', options: parseJson_(item.optionsJson, []) };
  });
  const knowledgeText = (knowledgeItems || []).map(function (item) { return '[' + item.category + '] ' + item.title + ': ' + item.content; }).join('\n');
  const historyText = (history || []).slice(-APP.MAX_CHAT_HISTORY).map(function (item) {
    const role = item.senderType === 'USER' ? 'ลูกค้า' : item.senderType === 'AI' ? 'ผู้ช่วย' : 'แอดมิน';
    return role + ': ' + (item.text || '[' + item.messageType + ']');
  }).join('\n');
  const orderJson = orderDraft ? JSON.stringify(orderDraft) : 'ยังไม่มีคำสั่งซื้อที่กำลังกรอก';
  const instruction = [
    'คุณเป็นผู้ช่วยร้าน ' + APP.RESTAURANT + ' ตอบเป็นภาษาไทย เป็นกันเอง สุภาพ กระชับ',
    'System Prompt ของร้าน: ' + systemPrompt,
    'ข้อมูลเมนูที่ขายจริง (ยึดเฉพาะรายการนี้ ห้ามแต่งชื่อหรือราคา): ' + JSON.stringify(menuSummary),
    'คลังความรู้ที่เกี่ยวข้อง: ' + (knowledgeText || 'ไม่มีข้อมูลที่ตรงคำถาม'),
    'ประวัติสนทนาล่าสุด:\n' + (historyText || 'ไม่มีประวัติ'),
    'คำสั่งซื้อที่กำลังกรอก: ' + orderJson,
    'หากลูกค้าขอคุยเจ้าหน้าที่ ให้ handoverRequested=true และตอบสั้น ๆ ว่ากำลังประสานเจ้าหน้าที่',
    'หากถามเมนูหรือขอรูป ให้ระบุ menuItemIds เฉพาะ id ที่อยู่ในรายการเมนูจริง',
    'หากลูกค้าสั่งอาหาร ให้อัปเดต order.items โดยใช้ menuItemId จากรายการเมนูจริง พร้อม quantity, options และ note; ระบุ fulfillmentType เป็น dine_in หรือ takeaway; arrivalTime เป็นเวลาภาษาไทย เช่น 12:00; partySize เป็นจำนวนคน; confirmed=true เฉพาะเมื่อลูกค้ายืนยันชัดเจน',
    'อย่าสร้างออเดอร์เอง อย่าบอกว่าออเดอร์ยืนยันแล้วจนกว่าลูกค้าพิมพ์ยืนยันและระบบบันทึกสำเร็จ',
    'ตอบกลับเป็น JSON ตาม schema เท่านั้น ไม่ใส่ Markdown หรือ code fence'
  ].join('\n\n');

  const schema = {
    type: 'OBJECT',
    properties: {
      reply: { type: 'STRING' },
      intent: { type: 'STRING' },
      handoverRequested: { type: 'BOOLEAN' },
      menuItemIds: { type: 'ARRAY', items: { type: 'STRING' } },
      order: {
        type: 'OBJECT',
        properties: {
          items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
            menuItemId: { type: 'STRING' }, quantity: { type: 'INTEGER' }, options: { type: 'STRING' }, note: { type: 'STRING' }
          }, required: ['menuItemId', 'quantity'] } },
          fulfillmentType: { type: 'STRING' },
          arrivalTime: { type: 'STRING' },
          partySize: { type: 'INTEGER' },
          note: { type: 'STRING' },
          confirmed: { type: 'BOOLEAN' }
        }
      }
    },
    required: ['reply', 'handoverRequested', 'menuItemIds']
  };

  const contents = [{ role: 'user', parts: [{ text: instruction + '\n\nข้อความล่าสุดจากลูกค้า: ' + userText }] }];
  const payload = {
    contents: contents,
    generationConfig: {
      temperature: Number(getSetting_('aiTemperature') || 0.4),
      maxOutputTokens: Number(getSetting_('aiMaxOutputTokens') || 700),
      responseMimeType: 'application/json',
      responseSchema: schema
    }
  };
  const url = APP.GEMINI_API_BASE + '/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  const response = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
  const code = response.getResponseCode();
  const responseText = response.getContentText();
  const result = parseJson_(responseText, {});
  if (code < 200 || code >= 300) throw new Error('Gemini API HTTP ' + code + ': ' + (result.error && result.error.message || responseText));
  const candidate = result.candidates && result.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts || [];
  const text = parts.map(function (part) { return part.text || ''; }).join('').trim();
  if (!text) throw new Error('Gemini ไม่ส่งข้อความตอบกลับ');
  return parseJson_(text, { reply: text, handoverRequested: false, menuItemIds: [] });
}

function normalizeAiResult_(result) {
  const data = typeof result === 'string' ? parseJson_(result, { reply: result }) : (result || {});
  return {
    reply: String(data.reply || '').trim(),
    intent: String(data.intent || 'general'),
    handoverRequested: data.handoverRequested === true,
    menuItemIds: Array.isArray(data.menuItemIds) ? data.menuItemIds : [],
    order: data.order && typeof data.order === 'object' ? data.order : null,
    menuItems: []
  };
}

function selectRelevantKnowledge_(text, limit) {
  const q = String(text || '').toLowerCase();
  return getAllRows_('KNOWLEDGE_BASE').filter(function (item) {
    return item.active === true || String(item.active) === 'true';
  }).map(function (item) {
    const terms = (String(item.keywords || '') + ' ' + String(item.title || '') + ' ' + String(item.category || '')).toLowerCase().split(/[\s,;|]+/).filter(Boolean);
    let score = 0;
    terms.forEach(function (term) { if (term.length > 1 && q.indexOf(term) >= 0) score++; });
    if (String(item.content || '').toLowerCase().indexOf(q) >= 0 && q.length > 4) score += 1;
    return { item: item, score: score + Number(item.priority || 0) * 0.01 };
  }).filter(function (entry) { return entry.score > 0; })
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, limit || 30).map(function (entry) { return entry.item; });
}

/* -------------------------------------------------------------------------- */
/* ORDER DRAFT / ORDER MANAGEMENT                                             */
/* -------------------------------------------------------------------------- */

function mergeAndValidateOrderDraft_(existingDraft, incoming, menuItems) {
  const draft = existingDraft ? JSON.parse(JSON.stringify(existingDraft)) : {
    items: [], fulfillmentType: '', arrivalTime: '', partySize: 0, note: '', stage: 'COLLECTING', createdAt: new Date().toISOString()
  };
  const menuById = {};
  menuItems.forEach(function (item) { menuById[String(item.menuItemId)] = item; });
  (incoming.items || []).forEach(function (incomingItem) {
    const menuItem = menuById[String(incomingItem.menuItemId)];
    if (!menuItem) return;
    const quantity = Math.max(1, Math.min(99, Number(incomingItem.quantity || 1)));
    const existingIndex = draft.items.findIndex(function (item) { return String(item.menuItemId) === String(menuItem.menuItemId) && String(item.options || '') === String(incomingItem.options || ''); });
    const normalized = { menuItemId: menuItem.menuItemId, name: menuItem.name, quantity: quantity, unitPrice: Number(menuItem.price || 0), options: String(incomingItem.options || ''), note: String(incomingItem.note || '') };
    if (existingIndex >= 0) draft.items[existingIndex] = normalized;
    else draft.items.push(normalized);
  });
  if (incoming.fulfillmentType === 'dine_in' || incoming.fulfillmentType === 'takeaway') draft.fulfillmentType = incoming.fulfillmentType;
  if (incoming.arrivalTime) draft.arrivalTime = String(incoming.arrivalTime).slice(0, 40);
  if (Number(incoming.partySize) > 0) draft.partySize = Math.min(99, Number(incoming.partySize));
  if (incoming.note) draft.note = String(incoming.note).slice(0, 500);
  draft.updatedAt = new Date().toISOString();
  return draft.items.length ? draft : null;
}

function getMissingOrderFields_(draft) {
  const missing = [];
  if (!draft.items || !draft.items.length) missing.push('items');
  if (!draft.fulfillmentType) missing.push('fulfillmentType');
  if (!draft.arrivalTime) missing.push('arrivalTime');
  if (!draft.partySize) missing.push('partySize');
  return missing;
}

function orderQuestion_(field, draft) {
  const questions = {
    items: 'ต้องการสั่งเมนูอะไร จำนวนกี่ที่คะ?',
    fulfillmentType: 'รับประทานที่ร้านหรือสั่งกลับบ้านดีคะ?',
    arrivalTime: 'จะเข้ามารับอาหารหรือมาถึงร้านประมาณกี่โมงคะ?',
    partySize: 'มากี่ท่านคะ?'
  };
  return questions[field] || 'ขอรายละเอียดเพิ่มเติมอีกนิดนะคะ';
}

function buildOrderSummary_(draft) {
  const lines = ['สรุปรายการสั่งอาหารล่วงหน้าค่ะ 🍜'];
  let total = 0;
  draft.items.forEach(function (item) {
    const subtotal = Number(item.unitPrice || 0) * Number(item.quantity || 1);
    total += subtotal;
    lines.push('- ' + item.name + ' x ' + item.quantity + ' = ' + formatMoney_(subtotal) + (item.options ? ' (' + item.options + ')' : ''));
  });
  lines.push('วิธีรับ: ' + (draft.fulfillmentType === 'dine_in' ? 'ทานที่ร้าน' : 'กลับบ้าน'));
  lines.push('เวลาที่มาถึง: ' + draft.arrivalTime);
  lines.push('จำนวนคน: ' + draft.partySize + ' คน');
  if (draft.note) lines.push('หมายเหตุ: ' + draft.note);
  lines.push('รวมประมาณ: ' + formatMoney_(total));
  return lines.join('\n');
}

function isPositiveConfirmation_(text) {
  return /(ยืนยัน|ถูกต้อง|ใช่ครับ|ใช่ค่ะ|ตกลง|ตามนี้|โอเค|ok|confirm)/i.test(String(text || ''));
}

function createOrderFromDraft_(userId, draft) {
  const member = getMemberById_(userId) || {};
  const orderId = 'JO-' + Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 90 + 10);
  const subtotal = (draft.items || []).reduce(function (sum, item) { return sum + Number(item.unitPrice || 0) * Number(item.quantity || 1); }, 0);
  const order = {
    orderId: orderId,
    userId: userId,
    displayName: member.displayName || 'ลูกค้า LINE',
    itemsJson: JSON.stringify(draft.items || []),
    subtotal: subtotal,
    total: subtotal,
    fulfillmentType: draft.fulfillmentType,
    arrivalTime: draft.arrivalTime,
    partySize: Number(draft.partySize || 0),
    note: draft.note || '',
    status: 'NEW',
    createdAt: new Date(),
    confirmedAt: new Date(),
    updatedAt: new Date(),
    groupNotifiedAt: ''
  };
  appendRow_('ORDERS', order);
  (draft.items || []).forEach(function (item) {
    appendRow_('ORDER_ITEMS', {
      orderItemId: Utilities.getUuid(), orderId: orderId, menuItemId: item.menuItemId, name: item.name,
      quantity: item.quantity, unitPrice: item.unitPrice, optionsJson: JSON.stringify(item.options || ''), note: item.note || ''
    });
  });
  appendOrderEvent_(orderId, '', 'NEW', 'AI/Customer', 'ลูกค้ายืนยันออเดอร์');
  notifyStaffNewOrder_(order);
  return order;
}

function createManualOrder(data) {
  const order = Object.assign({}, data, {
    orderId: data.orderId || 'JO-' + Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 90 + 10),
    itemsJson: JSON.stringify(data.items || []),
    status: data.status || 'NEW',
    createdAt: new Date(), updatedAt: new Date()
  });
  appendRow_('ORDERS', order);
  appendOrderEvent_(order.orderId, '', order.status, data.actor || 'Dashboard', 'สร้างออเดอร์ด้วยมือ');
  notifyStaffNewOrder_(order);
  return { ok: true, orderId: order.orderId };
}

function notifyStaffNewOrder_(order) {
  const groupId = getSetting_('staffGroupId') || getDefaultStaffGroupId_();
  if (!groupId) {
    logWarn_('ORDER', 'No staff group configured; order stored without group notification.', { orderId: order.orderId });
    return false;
  }
  const contents = buildOrderFlex_(order);
  try {
    linePush_(groupId, [{ type: 'flex', altText: 'ออเดอร์ใหม่ ' + order.orderId, contents: contents }], false);
    updateRowByKey_('ORDERS', 'orderId', order.orderId, { groupNotifiedAt: new Date(), updatedAt: new Date() });
    return true;
  } catch (error) {
    logError_('ORDER', 'Unable to notify staff group', error, { orderId: order.orderId });
    return false;
  }
}

function buildOrderFlex_(order) {
  const items = parseJson_(order.itemsJson, []);
  const itemContents = items.slice(0, 10).map(function (item) {
    return { type: 'box', layout: 'baseline', spacing: 'sm', contents: [
      { type: 'text', text: String(item.name || 'รายการ'), flex: 5, size: 'sm', wrap: true },
      { type: 'text', text: 'x' + Number(item.quantity || 1), flex: 1, size: 'sm', align: 'end' }
    ] };
  });
  const fulfillment = order.fulfillmentType === 'dine_in' ? 'ทานที่ร้าน' : order.fulfillmentType === 'takeaway' ? 'กลับบ้าน' : String(order.fulfillmentType || '-');
  const statusActions = ['ACCEPTED', 'COOKING', 'READY', 'COMPLETED'].map(function (status) {
    const label = { ACCEPTED: 'รับออเดอร์', COOKING: 'กำลังทำ', READY: 'อาหารพร้อม', COMPLETED: 'เสร็จแล้ว' }[status];
    return { type: 'button', style: status === 'READY' ? 'primary' : 'secondary', height: 'sm', action: { type: 'postback', label: label, data: 'action=order_status&orderId=' + encodeURIComponent(order.orderId) + '&status=' + status } };
  });
  return {
    type: 'bubble', size: 'giga',
    header: { type: 'box', layout: 'vertical', backgroundColor: '#0B8F45', paddingAll: '16px', contents: [
      { type: 'text', text: APP.RESTAURANT, color: '#FFFFFF', weight: 'bold', size: 'md' },
      { type: 'text', text: 'ออเดอร์ใหม่ ' + order.orderId, color: '#FFFFFF', size: 'sm', margin: 'sm' }
    ] },
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
      { type: 'text', text: 'ข้อมูลลูกค้า', weight: 'bold', size: 'md' },
      { type: 'text', text: 'ชื่อ: ' + (order.displayName || 'ลูกค้า LINE'), size: 'sm', wrap: true },
      { type: 'text', text: 'รูปแบบ: ' + fulfillment, size: 'sm' },
      { type: 'text', text: 'เวลามาถึง: ' + (order.arrivalTime || '-'), size: 'sm' },
      { type: 'text', text: 'จำนวนคน: ' + (order.partySize || '-') + ' คน', size: 'sm' },
      { type: 'separator', margin: 'md' },
      { type: 'text', text: 'รายการอาหาร', weight: 'bold', size: 'md' }
    ].concat(itemContents).concat([
      { type: 'separator', margin: 'md' },
      { type: 'text', text: 'รวม ' + formatMoney_(order.total || order.subtotal || 0), weight: 'bold', size: 'lg', color: '#0B8F45' },
      { type: 'text', text: 'หมายเหตุ: ' + (order.note || '-'), size: 'xs', wrap: true, color: '#666666' }
    ]) },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: statusActions }
  };
}

function getOrders(options) {
  const opts = options || {};
  let rows = getAllRows_('ORDERS').sort(function (a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
  if (opts.status) rows = rows.filter(function (row) { return String(row.status) === String(opts.status); });
  if (opts.query) {
    const q = String(opts.query).toLowerCase();
    rows = rows.filter(function (row) { return [row.orderId, row.displayName, row.userId].join(' ').toLowerCase().indexOf(q) >= 0; });
  }
  return { ok: true, total: rows.length, orders: rows.slice(0, Math.min(500, Number(opts.limit || 100))) };
}

function updateOrderStatus(data) {
  const order = getAllRows_('ORDERS').find(function (row) { return String(row.orderId) === String(data.orderId); });
  if (!order) throw new Error('ไม่พบออเดอร์');
  const previous = order.status;
  updateRowByKey_('ORDERS', 'orderId', data.orderId, { status: data.status, updatedAt: new Date() });
  appendOrderEvent_(data.orderId, previous, data.status, data.actor || 'Dashboard', data.note || '');
  if (order.userId && data.notifyCustomer !== false) {
    const messages = {
      ACCEPTED: 'ทางร้านรับออเดอร์ ' + data.orderId + ' แล้วค่ะ ❤️',
      COOKING: 'ออเดอร์ ' + data.orderId + ' กำลังจัดเตรียมค่ะ 🍜',
      READY: 'ออเดอร์ ' + data.orderId + ' พร้อมแล้วค่ะ',
      COMPLETED: 'ขอบคุณที่ใช้บริการก๋วยเตี๋ยวโบราณ by เจ๊อ้นค่ะ ❤️',
      CANCELLED: 'ขออภัยค่ะ ออเดอร์ ' + data.orderId + ' ถูกยกเลิกแล้ว กรุณาติดต่อร้านเพื่อสอบถามเพิ่มเติมค่ะ'
    };
    if (messages[data.status]) {
      try { linePush_(order.userId, [{ type: 'text', text: messages[data.status] }], false); } catch (error) { logWarn_('ORDER', 'Could not notify customer: ' + safeError_(error)); }
    }
  }
  return { ok: true };
}

function appendOrderEvent_(orderId, fromStatus, toStatus, actor, note) {
  appendRow_('ORDER_EVENTS', { eventId: Utilities.getUuid(), orderId: orderId, fromStatus: fromStatus || '', toStatus: toStatus || '', actor: actor || '', note: note || '', createdAt: new Date() });
}

/* -------------------------------------------------------------------------- */
/* LIVE CHAT / HUMAN HANDOVER                                                 */
/* -------------------------------------------------------------------------- */

function createChatSession_(userId) {
  const row = {
    userId: userId, replyMode: 'AI', assignedAgent: '', sessionStatus: 'OPEN', lastMessageAt: new Date(),
    waitingSince: '', deadlineAt: '', timeoutSent: false, conversationVersion: 1, orderDraftJson: '', unreadCount: 0,
    tagsJson: '[]', updatedAt: new Date()
  };
  upsertByKey_('CHAT_SESSIONS', 'userId', userId, row);
  return row;
}

function getChatSession_(userId) {
  const rows = getAllRows_('CHAT_SESSIONS');
  return rows.find(function (row) { return String(row.userId) === String(userId); }) || null;
}

function updateSessionActivity_(userId, unreadIncrement) {
  const session = getChatSession_(userId) || createChatSession_(userId);
  upsertByKey_('CHAT_SESSIONS', 'userId', userId, {
    lastMessageAt: new Date(),
    unreadCount: Math.max(0, Number(session.unreadCount || 0) + Number(unreadIncrement || 0)),
    conversationVersion: Number(session.conversationVersion || 0) + 1,
    updatedAt: new Date()
  });
}

function appendChatMessage_(userId, senderType, senderName, messageType, text, payload, deliveryStatus, lineMessageId) {
  appendRow_('CHAT_MESSAGES', {
    messageId: Utilities.getUuid(), userId: userId, senderType: senderType, senderName: senderName || '',
    messageType: messageType || 'text', text: String(text || ''), payloadJson: JSON.stringify(payload || {}),
    deliveryStatus: deliveryStatus || 'SENT', lineMessageId: lineMessageId || '', createdAt: new Date()
  });
}

function getLiveChats(options) {
  const opts = options || {};
  const members = {};
  getAllRows_('LINE_USERS').forEach(function (row) { members[row.userId] = row; });
  let sessions = getAllRows_('CHAT_SESSIONS');
  if (opts.mode) sessions = sessions.filter(function (row) { return String(row.replyMode) === String(opts.mode); });
  if (opts.query) {
    const q = String(opts.query).toLowerCase();
    sessions = sessions.filter(function (row) {
      const member = members[row.userId] || {};
      return String(member.displayName || '').toLowerCase().indexOf(q) >= 0 || String(row.userId).toLowerCase().indexOf(q) >= 0;
    });
  }
  sessions.sort(function (a, b) { return new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0); });
  return { ok: true, chats: sessions.slice(0, Math.min(300, Number(opts.limit || 100))).map(function (session) {
    return Object.assign({}, session, { member: members[session.userId] || {}, pendingHandover: getPendingHandover_(session.userId) });
  }) };
}

function getChatMessages(userId, limit) {
  const max = Math.min(200, Math.max(1, Number(limit || 60)));
  const rows = getAllRows_('CHAT_MESSAGES').filter(function (row) { return String(row.userId) === String(userId); });
  return { ok: true, messages: rows.slice(-max), total: rows.length };
}

function sendLiveChatMessage(data) {
  const userId = String(data.userId || '');
  const text = String(data.text || '').trim();
  if (!userId || !text) throw new Error('กรุณาระบุสมาชิกและข้อความ');
  const session = getChatSession_(userId) || createChatSession_(userId);
  if (data.agentName) {
    upsertByKey_('ADMINS', 'agentId', data.agentId || data.agentName, { agentName: data.agentName, displayName: data.agentName, active: true, updatedAt: new Date() });
  }
  const messageId = Utilities.getUuid();
  appendRow_('CHAT_MESSAGES', {
    messageId: messageId, userId: userId, senderType: 'ADMIN', senderName: data.agentName || getSetting_('defaultAgentName') || 'แอดมิน',
    messageType: 'text', text: text, payloadJson: '{}', deliveryStatus: 'SENDING', lineMessageId: '', createdAt: new Date()
  });
  try {
    const result = linePush_(userId, [{ type: 'text', text: text }], false);
    updateRowByKey_('CHAT_MESSAGES', 'messageId', messageId, { deliveryStatus: 'SENT' });
    upsertByKey_('CHAT_SESSIONS', 'userId', userId, { lastMessageAt: new Date(), unreadCount: 0, updatedAt: new Date() });
    return { ok: true, messageId: messageId, lineRequestId: result.headers && result.headers['x-line-request-id'] || '' };
  } catch (error) {
    updateRowByKey_('CHAT_MESSAGES', 'messageId', messageId, { deliveryStatus: 'FAILED' });
    throw error;
  }
}

function setChatMode(data) {
  const userId = String(data.userId || '');
  const mode = String(data.mode || '').toUpperCase();
  if (!userId || ['AI', 'HUMAN', 'PAUSED', 'CLOSED'].indexOf(mode) === -1) throw new Error('ข้อมูลโหมดแชทไม่ถูกต้อง');
  const current = getChatSession_(userId) || createChatSession_(userId);
  const agentName = data.agentName || getSetting_('defaultAgentName') || 'Ponlabat';
  const version = Number(current.conversationVersion || 0) + 1;
  if (mode === 'HUMAN') {
    upsertByKey_('CHAT_SESSIONS', 'userId', userId, {
      replyMode: 'HUMAN', assignedAgent: agentName, sessionStatus: 'OPEN', waitingSince: '', deadlineAt: '', timeoutSent: false,
      conversationVersion: version, updatedAt: new Date()
    });
    markHandoverAccepted_(userId, agentName);
    if (data.sendTransitionMessage !== false) {
      const template = getHandoverSetting_('acceptedMessage') || DEFAULT_HANDOVER_SETTINGS.acceptedMessage;
      const message = template.replace(/\{\{agent_name\}\}/g, agentName);
      linePush_(userId, [{ type: 'text', text: message }], false);
      appendChatMessage_(userId, 'ADMIN', agentName, 'text', message, { automatic: true, type: 'handover_accepted' }, 'SENT');
    }
  } else if (mode === 'AI') {
    upsertByKey_('CHAT_SESSIONS', 'userId', userId, { replyMode: 'AI', assignedAgent: '', sessionStatus: 'OPEN', waitingSince: '', deadlineAt: '', timeoutSent: false, conversationVersion: version, updatedAt: new Date() });
    cancelPendingHandover_(userId, 'CANCELLED');
    if (data.sendTransitionMessage) {
      const message = getHandoverSetting_('returnedToAiMessage') || DEFAULT_HANDOVER_SETTINGS.returnedToAiMessage;
      linePush_(userId, [{ type: 'text', text: message }], false);
      appendChatMessage_(userId, 'AI', APP.RESTAURANT, 'text', message, { automatic: true, type: 'returned_to_ai' }, 'SENT');
    }
  } else {
    upsertByKey_('CHAT_SESSIONS', 'userId', userId, { replyMode: mode, assignedAgent: mode === 'PAUSED' ? agentName : '', sessionStatus: mode, conversationVersion: version, updatedAt: new Date() });
    if (mode === 'CLOSED') cancelPendingHandover_(userId, 'CANCELLED');
  }
  return { ok: true, mode: mode, conversationVersion: version };
}

function acceptHandover(data) {
  return setChatMode({ userId: data.userId, mode: 'HUMAN', agentName: data.agentName || getSetting_('defaultAgentName') || 'Ponlabat', sendTransitionMessage: true });
}

function closeChat(data) {
  return setChatMode({ userId: data.userId, mode: 'CLOSED', agentName: data.agentName || '' });
}

function containsHandoverIntent_(text) {
  return /(ติดต่อเจ้าหน้าที่|ติดต่อแอดมิน|ขอคุยกับแอดมิน|ขอคุยกับเจ้าหน้าที่|ขอคุยกับคน|คุยกับพนักงาน|ขอคนจริง|แอดมินหน่อย|พนักงานหน่อย|operator|human agent)/i.test(String(text || ''));
}

function beginHandover_(userId, replyToken, reason, aiReply) {
  const settings = getHandoverSettings();
  if (!settings.enabled) {
    const fallback = aiReply || 'ขออภัยค่ะ ขณะนี้ยังไม่สามารถโอนสายให้เจ้าหน้าที่ได้ กรุณาฝากข้อความไว้หรือโทร 0626590910 ค่ะ';
    if (replyToken) lineReply_(replyToken, [{ type: 'text', text: fallback }]);
    else linePush_(userId, [{ type: 'text', text: fallback }], false);
    return;
  }
  const current = getChatSession_(userId) || createChatSession_(userId);
  if (current.replyMode === 'HUMAN') return;
  const now = new Date();
  const timeoutMinutes = Math.max(1, Number(settings.timeoutMinutes || APP.DEFAULT_HANDOVER_MINUTES));
  const deadline = new Date(now.getTime() + timeoutMinutes * 60 * 1000);
  const handoverId = Utilities.getUuid();
  upsertByKey_('CHAT_SESSIONS', 'userId', userId, {
    replyMode: 'WAITING', assignedAgent: '', sessionStatus: 'WAITING', waitingSince: now, deadlineAt: deadline,
    timeoutSent: false, conversationVersion: Number(current.conversationVersion || 0) + 1, updatedAt: now
  });
  appendRow_('HANDOVER_QUEUE', {
    handoverId: handoverId, userId: userId, requestedAt: now, deadlineAt: deadline, handoverStatus: 'WAITING',
    assignedAgent: '', timeoutSent: false, lastCustomerMessageAt: now, createdAt: now, updatedAt: now
  });
  const initialMessage = aiReply || settings.initialMessage || DEFAULT_HANDOVER_SETTINGS.initialMessage;
  if (replyToken) lineReply_(replyToken, [{ type: 'text', text: initialMessage }]);
  else linePush_(userId, [{ type: 'text', text: initialMessage }], false);
  appendChatMessage_(userId, 'AI', APP.RESTAURANT, 'text', initialMessage, { automatic: true, type: 'handover_waiting' }, 'SENT');
  if (settings.notifyStaff) notifyStaffHandover_(userId, handoverId, deadline, reason);
}

function notifyStaffHandover_(userId, handoverId, deadline, reason) {
  const groupId = getSetting_('staffGroupId') || getDefaultStaffGroupId_();
  if (!groupId) return false;
  const member = getMemberById_(userId) || {};
  const contents = {
    type: 'bubble',
    header: { type: 'box', layout: 'vertical', backgroundColor: '#C47A12', paddingAll: '14px', contents: [
      { type: 'text', text: 'มีลูกค้าขอคุยกับเจ้าหน้าที่', color: '#FFFFFF', weight: 'bold', size: 'md' }
    ] },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      { type: 'text', text: 'ลูกค้า: ' + (member.displayName || 'LINE User'), weight: 'bold', size: 'md' },
      { type: 'text', text: 'เหตุผล: ' + (reason || 'ลูกค้าต้องการติดต่อพนักงาน'), size: 'sm', wrap: true },
      { type: 'text', text: 'รอถึง: ' + Utilities.formatDate(deadline, APP.TIMEZONE, 'HH:mm:ss'), size: 'sm' },
      { type: 'text', text: 'กรุณาเปิด Live Chat แล้วกดรับช่วงสนทนา', size: 'xs', color: '#666666', wrap: true }
    ] }
  };
  try { linePush_(groupId, [{ type: 'flex', altText: 'มีลูกค้ารอเจ้าหน้าที่', contents: contents }], false); return true; }
  catch (error) { logError_('HANDOVER', 'Unable to notify staff group', error, { userId: userId, handoverId: handoverId }); return false; }
}

function getHandoverSettings() {
  const settings = Object.assign({}, DEFAULT_HANDOVER_SETTINGS);
  getAllRows_('HANDOVER_SETTINGS').forEach(function (row) { settings[row.key] = parseSettingValue_(row.value); });
  settings.enabled = settings.enabled !== false && settings.enabled !== 'false';
  settings.resumeAiAfterTimeout = settings.resumeAiAfterTimeout !== false && settings.resumeAiAfterTimeout !== 'false';
  settings.notifyStaff = settings.notifyStaff !== false && settings.notifyStaff !== 'false';
  return settings;
}

function getHandoverSetting_(key) {
  const rows = getAllRows_('HANDOVER_SETTINGS');
  const row = rows.find(function (item) { return String(item.key) === String(key); });
  return row ? parseSettingValue_(row.value) : null;
}

function saveHandoverSettings(data) {
  Object.keys(DEFAULT_HANDOVER_SETTINGS).forEach(function (key) {
    if (data[key] !== undefined) upsertByKey_('HANDOVER_SETTINGS', 'key', key, { value: typeof data[key] === 'object' ? JSON.stringify(data[key]) : String(data[key]), updatedAt: new Date() });
  });
  return { ok: true, settings: getHandoverSettings() };
}

function getHandoverQueue(options) {
  const status = options && options.status || 'WAITING';
  const rows = getAllRows_('HANDOVER_QUEUE').filter(function (row) { return !status || String(row.handoverStatus) === String(status); })
    .sort(function (a, b) { return new Date(a.requestedAt || 0) - new Date(b.requestedAt || 0); });
  return { ok: true, queue: rows.map(function (row) { return Object.assign({}, row, { member: getMemberById_(row.userId) || {} }); }) };
}

function getPendingHandover_(userId) {
  return getAllRows_('HANDOVER_QUEUE').find(function (row) { return String(row.userId) === String(userId) && String(row.handoverStatus) === 'WAITING'; }) || null;
}

function getPendingHandoverId_(userId) {
  const item = getPendingHandover_(userId);
  return item ? item.handoverId : '';
}

function markHandoverAccepted_(userId, agentName) {
  const pending = getPendingHandover_(userId);
  if (pending) updateRowByKey_('HANDOVER_QUEUE', 'handoverId', pending.handoverId, { handoverStatus: 'ACCEPTED', assignedAgent: agentName, updatedAt: new Date() });
}

function cancelPendingHandover_(userId, status) {
  const pending = getPendingHandover_(userId);
  if (pending) updateRowByKey_('HANDOVER_QUEUE', 'handoverId', pending.handoverId, { handoverStatus: status || 'CANCELLED', updatedAt: new Date() });
}

function processHandoverTimeoutQueue() {
  const now = new Date();
  const pending = getAllRows_('HANDOVER_QUEUE').filter(function (row) { return String(row.handoverStatus) === 'WAITING' && !row.timeoutSent && new Date(row.deadlineAt).getTime() <= now.getTime(); });
  let sent = 0;
  pending.forEach(function (item) {
    const session = getChatSession_(item.userId);
    if (!session || session.replyMode !== 'WAITING') {
      updateRowByKey_('HANDOVER_QUEUE', 'handoverId', item.handoverId, { handoverStatus: 'CANCELLED', updatedAt: new Date() });
      return;
    }
    const settings = getHandoverSettings();
    const message = settings.timeoutMessage || DEFAULT_HANDOVER_SETTINGS.timeoutMessage;
    try {
      linePush_(item.userId, [{ type: 'text', text: message }], false);
      appendChatMessage_(item.userId, 'AI', APP.RESTAURANT, 'text', message, { automatic: true, type: 'handover_timeout' }, 'SENT');
      updateRowByKey_('HANDOVER_QUEUE', 'handoverId', item.handoverId, { handoverStatus: 'TIMEOUT', timeoutSent: true, updatedAt: new Date() });
      upsertByKey_('CHAT_SESSIONS', 'userId', item.userId, {
        replyMode: settings.resumeAiAfterTimeout ? 'AI' : 'PAUSED', assignedAgent: '', sessionStatus: 'TIMEOUT',
        timeoutSent: true, deadlineAt: '', waitingSince: '', conversationVersion: Number(session.conversationVersion || 0) + 1, updatedAt: new Date()
      });
      incrementMetric_('handover_timeout', 1);
      sent++;
    } catch (error) {
      logError_('HANDOVER_TIMEOUT', 'Failed to send timeout message', error, { userId: item.userId, handoverId: item.handoverId });
    }
  });
  return { ok: true, checked: pending.length, sent: sent };
}

/* -------------------------------------------------------------------------- */
/* KEYWORD RULES / AUTOMATIONS                                                */
/* -------------------------------------------------------------------------- */

function getKeywordRules() { return { ok: true, rules: getAllRows_('KEYWORD_RULES').sort(function (a, b) { return Number(b.priority || 0) - Number(a.priority || 0); }) }; }

function saveKeywordRule(data) {
  const id = data.ruleId || Utilities.getUuid();
  upsertByKey_('KEYWORD_RULES', 'ruleId', id, {
    name: data.name || 'Keyword Rule', keywords: Array.isArray(data.keywords) ? data.keywords.join('|') : String(data.keywords || ''),
    matchType: data.matchType || 'contains', responseType: data.responseType || 'text',
    responsePayloadJson: JSON.stringify(data.responsePayload || parseJson_(data.responsePayloadJson, {})),
    priority: Number(data.priority || 0), active: data.active !== false, createdAt: data.createdAt || new Date(), updatedAt: new Date()
  });
  return { ok: true, ruleId: id };
}

function deleteKeywordRule(ruleId) { return { ok: deleteRowByKey_('KEYWORD_RULES', 'ruleId', ruleId) }; }

function matchKeywordRule_(text) {
  const value = String(text || '').toLowerCase();
  return getAllRows_('KEYWORD_RULES').filter(function (row) { return row.active === true || String(row.active) === 'true'; })
    .sort(function (a, b) { return Number(b.priority || 0) - Number(a.priority || 0); }).find(function (row) {
      const keywords = String(row.keywords || '').split(/[|,;\n]+/).map(function (item) { return item.trim().toLowerCase(); }).filter(Boolean);
      return keywords.some(function (keyword) {
        if (row.matchType === 'exact') return value === keyword;
        if (row.matchType === 'startsWith') return value.indexOf(keyword) === 0;
        return value.indexOf(keyword) >= 0;
      });
    }) || null;
}

function sendRuleResponse_(event, userId, rule) {
  const payload = parseJson_(rule.responsePayloadJson, {});
  let messages = [];
  if (rule.responseType === 'flex') messages = [{ type: 'flex', altText: payload.altText || rule.name, contents: payload.contents || payload }];
  else if (rule.responseType === 'image') messages = [{ type: 'image', originalContentUrl: payload.imageUrl, previewImageUrl: payload.previewImageUrl || payload.imageUrl }];
  else messages = [{ type: 'text', text: payload.text || payload.message || '' }];
  messages = messages.filter(function (message) { return message.type !== 'text' || message.text; });
  if (event.replyToken) lineReply_(event.replyToken, messages.slice(0, 5));
  else linePush_(userId, messages.slice(0, 5), false);
  messages.forEach(function (message) { appendChatMessage_(userId, 'AI', APP.RESTAURANT, message.type, message.text || '', message, 'SENT'); });
}

function runMessageAutomations_(event, userId, text) {
  const automations = getAllRows_('AUTOMATIONS').filter(function (row) {
    return (row.active === true || String(row.active) === 'true') && String(row.triggerType) === 'keyword';
  });
  const lowered = String(text || '').toLowerCase();
  for (let i = 0; i < automations.length; i++) {
    const automation = automations[i];
    const trigger = String(automation.triggerValue || '').toLowerCase();
    if (!trigger || lowered.indexOf(trigger) < 0) continue;
    const payload = parseJson_(automation.actionPayloadJson, {});
    if (automation.actionType === 'handover') {
      beginHandover_(userId, event.replyToken, 'Automation: ' + automation.name);
      return { stopProcessing: true };
    }
    if (automation.actionType === 'send_text') {
      const message = String(payload.text || payload.message || '');
      if (message) {
        if (event.replyToken) lineReply_(event.replyToken, [{ type: 'text', text: message }]);
        else linePush_(userId, [{ type: 'text', text: message }], false);
        appendChatMessage_(userId, 'AI', APP.RESTAURANT, 'text', message, { automationId: automation.automationId }, 'SENT');
        return { stopProcessing: true };
      }
    }
    if (automation.actionType === 'send_flex') {
      const contents = payload.contents || parseJson_(payload.contentsJson, {});
      validateFlexContents_(contents);
      const message = { type: 'flex', altText: payload.altText || automation.name, contents: contents };
      if (event.replyToken) lineReply_(event.replyToken, [message]);
      else linePush_(userId, [message], false);
      appendChatMessage_(userId, 'AI', APP.RESTAURANT, 'flex', '', { automationId: automation.automationId, contents: contents }, 'SENT');
      return { stopProcessing: true };
    }
    if (automation.actionType === 'add_tag') {
      const member = getMemberById_(userId) || {};
      const tags = parseJson_(member.tagsJson, []);
      tags.push(String(payload.tag || 'Automation'));
      updateRowByKey_('LINE_USERS', 'userId', userId, { tagsJson: JSON.stringify(uniqueStrings_(tags)), updatedAt: new Date() });
    }
  }
  return { stopProcessing: false };
}

function getAutomations() { return { ok: true, automations: getAllRows_('AUTOMATIONS') }; }

function saveAutomation(data) {
  const id = data.automationId || Utilities.getUuid();
  upsertByKey_('AUTOMATIONS', 'automationId', id, {
    name: data.name || 'Automation', triggerType: data.triggerType || 'keyword', triggerValue: data.triggerValue || '',
    actionType: data.actionType || 'send_text', actionPayloadJson: JSON.stringify(data.actionPayload || parseJson_(data.actionPayloadJson, {})),
    active: data.active !== false, createdAt: data.createdAt || new Date(), updatedAt: new Date()
  });
  return { ok: true, automationId: id };
}

function deleteAutomation(automationId) { return { ok: deleteRowByKey_('AUTOMATIONS', 'automationId', automationId) }; }

/* -------------------------------------------------------------------------- */
/* BROADCAST QUEUE                                                            */
/* -------------------------------------------------------------------------- */

function getBroadcasts(options) {
  const rows = getAllRows_('BROADCAST').sort(function (a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
  return { ok: true, broadcasts: rows.slice(0, Math.min(200, Number(options && options.limit || 100))) };
}

function createBroadcast(data) {
  if (getSetting_('broadcastEnabled') === false) throw new Error('ระบบ Broadcast ถูกปิดใช้งาน');
  const ids = uniqueStrings_(data.userIds || []);
  if (!ids.length) throw new Error('กรุณาเลือกผู้รับอย่างน้อย 1 คน');
  const messages = data.messages || [data.message].filter(Boolean);
  if (!messages.length || messages.length > 5) throw new Error('Broadcast ต้องมีข้อความ 1-5 รายการ');
  messages.forEach(validateLineMessage_);
  const id = 'BC-' + Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 90 + 10);
  const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : new Date();
  appendRow_('BROADCAST', {
    broadcastId: id, name: data.name || 'Broadcast ' + id, templateType: data.templateType || 'custom',
    payloadJson: JSON.stringify(messages), recipientMode: 'selected', recipientCount: ids.length,
    status: scheduledAt.getTime() > Date.now() ? 'SCHEDULED' : 'QUEUED', scheduledAt: scheduledAt,
    createdAt: new Date(), startedAt: '', completedAt: '', sentCount: 0, failedCount: 0
  });
  ids.forEach(function (userId) {
    appendRow_('BROADCAST_RECIPIENTS', { recipientId: Utilities.getUuid(), broadcastId: id, userId: userId, status: 'PENDING', error: '', sentAt: '' });
  });
  return { ok: true, broadcastId: id, recipients: ids.length };
}

function processBroadcastQueue() {
  const now = Date.now();
  const jobs = getAllRows_('BROADCAST').filter(function (row) {
    return ['QUEUED', 'SCHEDULED', 'RUNNING'].indexOf(String(row.status)) >= 0 && (!row.scheduledAt || new Date(row.scheduledAt).getTime() <= now);
  });
  let processed = 0;
  jobs.forEach(function (job) {
    const allRecipients = getAllRows_('BROADCAST_RECIPIENTS').filter(function (row) { return String(row.broadcastId) === String(job.broadcastId) && String(row.status) === 'PENDING'; });
    const batch = allRecipients.slice(0, APP.MAX_BROADCAST_BATCH);
    if (!batch.length) {
      updateRowByKey_('BROADCAST', 'broadcastId', job.broadcastId, { status: 'COMPLETED', completedAt: new Date(), updatedAt: new Date() });
      return;
    }
    const messages = parseJson_(job.payloadJson, []);
    batch.forEach(function (recipient) {
      try {
        linePush_(recipient.userId, messages, false);
        updateRowByKey_('BROADCAST_RECIPIENTS', 'recipientId', recipient.recipientId, { status: 'SENT', sentAt: new Date(), error: '' });
        updateBroadcastCounts_(job.broadcastId, 1, 0);
        processed++;
      } catch (error) {
        updateRowByKey_('BROADCAST_RECIPIENTS', 'recipientId', recipient.recipientId, { status: 'FAILED', error: safeError_(error), sentAt: new Date() });
        updateBroadcastCounts_(job.broadcastId, 0, 1);
      }
    });
    const remaining = getAllRows_('BROADCAST_RECIPIENTS').some(function (row) { return String(row.broadcastId) === String(job.broadcastId) && String(row.status) === 'PENDING'; });
    updateRowByKey_('BROADCAST', 'broadcastId', job.broadcastId, { status: remaining ? 'RUNNING' : 'COMPLETED', startedAt: job.startedAt || new Date(), completedAt: remaining ? '' : new Date() });
  });
  return { ok: true, processed: processed, jobs: jobs.length };
}

function retryFailedBroadcastRecipients(broadcastId) {
  const rows = getAllRows_('BROADCAST_RECIPIENTS').filter(function (row) { return String(row.broadcastId) === String(broadcastId) && String(row.status) === 'FAILED'; });
  rows.forEach(function (row) { updateRowByKey_('BROADCAST_RECIPIENTS', 'recipientId', row.recipientId, { status: 'PENDING', error: '', sentAt: '' }); });
  if (rows.length) updateRowByKey_('BROADCAST', 'broadcastId', broadcastId, { status: 'QUEUED', completedAt: '' });
  return { ok: true, queuedForRetry: rows.length };
}

function updateBroadcastCounts_(broadcastId, sent, failed) {
  const row = getAllRows_('BROADCAST').find(function (item) { return String(item.broadcastId) === String(broadcastId); });
  if (!row) return;
  updateRowByKey_('BROADCAST', 'broadcastId', broadcastId, { sentCount: Number(row.sentCount || 0) + sent, failedCount: Number(row.failedCount || 0) + failed });
}

/* -------------------------------------------------------------------------- */
/* STAFF / ADMINS / GROUPS                                                    */
/* -------------------------------------------------------------------------- */

function getDefaultStaffGroupId_() {
  const row = getAllRows_('STAFF_GROUPS').find(function (item) { return (item.isDefault === true || String(item.isDefault) === 'true') && (item.active === true || String(item.active) === 'true'); });
  return row ? row.groupId : '';
}

function getStaffGroups() { return { ok: true, groups: getAllRows_('STAFF_GROUPS') }; }

function saveStaffGroup(data) {
  const id = data.groupId;
  if (!id) throw new Error('กรุณาระบุ Group ID จาก LINE');
  if (data.isDefault) getAllRows_('STAFF_GROUPS').forEach(function (row) { updateRowByKey_('STAFF_GROUPS', 'groupId', row.groupId, { isDefault: false }); });
  upsertByKey_('STAFF_GROUPS', 'groupId', id, { name: data.name || 'กลุ่มพนักงาน', isDefault: !!data.isDefault, active: data.active !== false, createdAt: data.createdAt || new Date(), updatedAt: new Date() });
  if (data.isDefault) setSetting_('staffGroupId', id, 'กลุ่ม LINE พนักงานหลัก');
  return { ok: true };
}

function deleteStaffGroup(groupId) { return { ok: deleteRowByKey_('STAFF_GROUPS', 'groupId', groupId) }; }
function getAdmins() { return { ok: true, admins: getAllRows_('ADMINS') }; }

function saveAdmin(data) {
  const id = data.agentId || data.agentName || Utilities.getUuid();
  upsertByKey_('ADMINS', 'agentId', id, { agentName: data.agentName || 'พนักงาน', displayName: data.displayName || data.agentName || 'พนักงาน', active: data.active !== false, createdAt: data.createdAt || new Date(), updatedAt: new Date() });
  return { ok: true, agentId: id };
}

function deleteAdmin(agentId) { return { ok: deleteRowByKey_('ADMINS', 'agentId', agentId) }; }

/* -------------------------------------------------------------------------- */
/* RICH MENU MANAGEMENT                                                       */
/* -------------------------------------------------------------------------- */

function getRichMenus() { return { ok: true, richMenus: getAllRows_('RICH_MENUS') }; }

function createRichMenu(data) {
  const payload = data.richMenu || parseJson_(data.richMenuJson, null);
  if (!payload || !payload.size || !Array.isArray(payload.areas)) throw new Error('ข้อมูล Rich Menu ไม่ถูกต้อง');
  const result = lineRequest_('POST', '/v2/bot/richmenu', payload);
  if (!result.ok) throw new Error('สร้าง Rich Menu ไม่สำเร็จ: ' + result.error);
  appendRow_('RICH_MENUS', {
    richMenuId: Utilities.getUuid(), name: data.name || 'Rich Menu', richMenuLineId: result.data.richMenuId,
    imageUrl: data.imageUrl || '', isDefault: false, active: true, areasJson: JSON.stringify(payload.areas), createdAt: new Date(), updatedAt: new Date()
  });
  return { ok: true, richMenuLineId: result.data.richMenuId };
}

function uploadRichMenuImage(data) {
  const richMenuLineId = data.richMenuLineId;
  if (!richMenuLineId || !data.base64) throw new Error('ต้องระบุ Rich Menu ID และรูปภาพ');
  const base64 = String(data.base64).replace(/^data:[^;]+;base64,/, '');
  const bytes = Utilities.base64Decode(base64);
  const contentType = data.contentType || 'image/png';
  const blob = Utilities.newBlob(bytes, contentType, data.name || 'richmenu.png');
  const result = lineRequest_('POST', '/v2/bot/richmenu/' + encodeURIComponent(richMenuLineId) + '/content', blob, { dataHost: true, raw: true, contentType: contentType });
  if (!result.ok) throw new Error('อัปโหลดรูป Rich Menu ไม่สำเร็จ: ' + result.error);
  return { ok: true };
}

function linkRichMenuToUser(data) {
  const result = lineRequest_('POST', '/v2/bot/user/' + encodeURIComponent(data.userId) + '/richmenu/' + encodeURIComponent(data.richMenuLineId), {});
  if (!result.ok) throw new Error(result.error);
  return { ok: true };
}

function unlinkRichMenuFromUser(userId) {
  const result = lineRequest_('DELETE', '/v2/bot/user/' + encodeURIComponent(userId) + '/richmenu', null);
  if (!result.ok) throw new Error(result.error);
  return { ok: true };
}

function setDefaultRichMenu(richMenuLineId) {
  const result = lineRequest_('POST', '/v2/bot/user/all/richmenu/' + encodeURIComponent(richMenuLineId), {});
  if (!result.ok) throw new Error(result.error);
  getAllRows_('RICH_MENUS').forEach(function (row) { updateRowByKey_('RICH_MENUS', 'richMenuId', row.richMenuId, { isDefault: String(row.richMenuLineId) === String(richMenuLineId), updatedAt: new Date() }); });
  return { ok: true };
}

function deleteRichMenu(richMenuLineId) {
  const result = lineRequest_('DELETE', '/v2/bot/richmenu/' + encodeURIComponent(richMenuLineId), null);
  if (!result.ok) throw new Error(result.error);
  const row = getAllRows_('RICH_MENUS').find(function (item) { return String(item.richMenuLineId) === String(richMenuLineId); });
  if (row) deleteRowByKey_('RICH_MENUS', 'richMenuId', row.richMenuId);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* REPORTS / DASHBOARD / SYSTEM QUEUES                                        */
/* -------------------------------------------------------------------------- */

function getDashboardData() {
  const today = Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd');
  const members = getAllRows_('LINE_USERS');
  const sessions = getAllRows_('CHAT_SESSIONS');
  const orders = getAllRows_('ORDERS');
  const messages = getAllRows_('CHAT_MESSAGES');
  const todayMembers = members.filter(function (row) { return String(row.followedAt || row.createdAt || '').indexOf(today) === 0; }).length;
  const todayOrders = orders.filter(function (row) { return String(row.createdAt || '').indexOf(today) === 0; });
  const waiting = sessions.filter(function (row) { return row.replyMode === 'WAITING'; }).length;
  const human = sessions.filter(function (row) { return row.replyMode === 'HUMAN'; }).length;
  const todayMessages = messages.filter(function (row) { return String(row.createdAt || '').indexOf(today) === 0; });
  return {
    ok: true,
    restaurant: APP.RESTAURANT,
    stats: {
      totalFriends: members.filter(function (row) { return !(row.isBlocked === true || String(row.isBlocked) === 'true'); }).length,
      newFriendsToday: todayMembers,
      totalChats: sessions.length,
      waitingAgents: waiting,
      humanChats: human,
      messagesToday: todayMessages.length,
      ordersToday: todayOrders.length,
      salesToday: todayOrders.reduce(function (sum, order) { return sum + Number(order.total || 0); }, 0),
      openOrders: orders.filter(function (row) { return ['NEW', 'ACCEPTED', 'COOKING'].indexOf(String(row.status)) >= 0; }).length
    },
    recentOrders: orders.sort(function (a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); }).slice(0, 8),
    system: getSystemStatus()
  };
}

function getReports(options) {
  const metrics = getAllRows_('ANALYTICS');
  const orders = getAllRows_('ORDERS');
  const messages = getAllRows_('CHAT_MESSAGES');
  const today = Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd');
  return {
    ok: true,
    metrics: metrics,
    summary: {
      orders: orders.length,
      revenue: orders.reduce(function (sum, row) { return sum + Number(row.total || 0); }, 0),
      aiMessages: messages.filter(function (row) { return row.senderType === 'AI'; }).length,
      adminMessages: messages.filter(function (row) { return row.senderType === 'ADMIN'; }).length,
      today: today
    }
  };
}

function incrementMetric_(metric, amount) {
  const date = Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd');
  const rows = getAllRows_('ANALYTICS');
  const key = date + '|' + metric;
  const existing = rows.find(function (row) { return String(row.date) === date && String(row.metric) === metric; });
  if (existing) {
    const rowNumber = findAnalyticsRow_(date, metric);
    if (rowNumber > 0) {
      const sheet = getSheet_('ANALYTICS');
      const headers = getHeaders_(sheet);
      const values = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
      const index = headers.indexOf('value');
      values[index] = Number(values[index] || 0) + Number(amount || 1);
      values[headers.indexOf('updatedAt')] = new Date();
      sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
    }
  } else {
    appendRow_('ANALYTICS', { date: date, metric: metric, value: Number(amount || 1), updatedAt: new Date() });
  }
}

function findAnalyticsRow_(date, metric) {
  const rows = getAllRows_('ANALYTICS');
  const index = rows.findIndex(function (row) { return String(row.date) === date && String(row.metric) === metric; });
  return index < 0 ? -1 : index + 2;
}

function getSystemLogs(options) {
  const limit = Math.min(300, Number(options && options.limit || 100));
  const rows = getAllRows_('SYSTEM_LOGS').sort(function (a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
  return { ok: true, logs: rows.slice(0, limit) };
}

function processSystemQueues() {
  const handover = processHandoverTimeoutQueue();
  const broadcast = processBroadcastQueue();
  return { ok: true, handover: handover, broadcast: broadcast };
}

/* -------------------------------------------------------------------------- */
/* LOGGING / HELPERS                                                          */
/* -------------------------------------------------------------------------- */

function logInfo_(module, message, detail) { writeLog_('INFO', module, message, detail); }
function logWarn_(module, message, detail) { writeLog_('WARN', module, message, detail); }
function logError_(module, message, error, detail) {
  writeLog_('ERROR', module, message, Object.assign({ error: safeError_(error), stack: error && error.stack ? String(error.stack).slice(0, 3000) : '' }, detail || {}));
}

function writeLog_(level, module, message, detail) {
  try {
    appendRow_('SYSTEM_LOGS', {
      logId: Utilities.getUuid(), level: level, module: module, message: String(message || ''),
      detail: JSON.stringify(detail || {}).slice(0, 45000), createdAt: new Date()
    });
  } catch (error) {
    console.error(level + ' ' + module + ' ' + message + ' ' + safeError_(error));
  }
}

function safeError_(error) {
  if (!error) return 'Unknown error';
  return String(error.message || error).slice(0, 1500);
}

function jsonOutput_(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}

function parseJson_(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (error) { return fallback; }
}

function uniqueStrings_(values) {
  const seen = {};
  return (Array.isArray(values) ? values : []).map(function (value) { return String(value || '').trim(); }).filter(function (value) {
    if (!value || seen[value]) return false;
    seen[value] = true;
    return true;
  });
}

function isHttpsUrl_(value) { return /^https:\/\//i.test(String(value || '')); }

function formatMoney_(amount) {
  return Number(amount || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 }) + ' บาท';
}

function parseQueryString_(query) {
  const out = {};
  String(query || '').split('&').forEach(function (part) {
    if (!part) return;
    const pieces = part.split('=');
    out[decodeURIComponent(pieces[0] || '')] = decodeURIComponent((pieces[1] || '').replace(/\+/g, ' '));
  });
  return out;
}

function constantTimeEquals_(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i++) result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return result === 0;
}

function clearAppCaches_() {
  const cache = CacheService.getScriptCache();
  [APP.SETTINGS_CACHE_KEY, APP.MENU_CACHE_KEY, APP.PROMPT_CACHE_KEY].forEach(function (key) { cache.remove(key); });
}

function getWebhookSetupInstructions_() {
  return {
    webhookUrl: getWebhookUrl_(),
    steps: [
      'เปิด LINE Developers Console แล้วเลือก Messaging API Channel ของร้าน',
      'นำ Webhook URL ที่ได้จาก getWebhookUrl_() ไปวางในช่อง Webhook URL',
      'กด Verify และเปิด Use webhook',
      'ปิด Greeting Message และ Auto-response ใน LINE OA Manager หากให้ระบบนี้เป็นผู้ส่งข้อความเอง',
      'เพิ่ม LINE OA เข้ากลุ่มพนักงาน แล้วตั้งกลุ่มหลักใน Dashboard',
      'ข้อจำกัด: Apps Script ไม่สามารถอ่าน x-line-signature จาก doPost(e) ได้โดยตรง; สำหรับ production ควรใช้ proxy ตรวจ signature ก่อนส่งต่อ'
    ]
  };
}

/** Utility for admins: clear the pagination cursor and start friends sync again. */
function resetFollowersSyncCursor() {
  PropertiesService.getScriptProperties().deleteProperty('FOLLOWERS_CURSOR');
  return { ok: true };
}

/** Utility for admins: return all sheet names and row counts. */
function getDatabaseDiagnostics() {
  const spreadsheet = getSpreadsheet_();
  const sheets = Object.keys(DB_SCHEMA).map(function (name) {
    const sheet = spreadsheet.getSheetByName(name);
    return { name: name, exists: !!sheet, rows: sheet ? Math.max(0, sheet.getLastRow() - 1) : 0, columns: sheet ? sheet.getLastColumn() : 0 };
  });
  return { ok: true, spreadsheetUrl: spreadsheet.getUrl(), sheets: sheets };
}

