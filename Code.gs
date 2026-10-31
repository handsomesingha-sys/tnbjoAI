/**
 * LINE AI STUDIO - ก๋วยเตี๋ยวโบราณ by เจ๊อ้น
 * Backend: Google Apps Script (V8)
 * Database: One Google Spreadsheet, multiple tabs
 * Frontend contract: index.html uses google.script.run.api...
 *
 * IMPORTANT SECURITY NOTES
 * 1) Apps Script Web Apps do not expose incoming HTTP request headers in doPost(e).
 *    Therefore this file cannot validate LINE's X-Line-Signature directly.
 *    It validates a WEBHOOK_SECRET query parameter instead. This is a compensating
 *    control, not equivalent to LINE signature verification. For production-grade
 *    webhook verification, put a Cloudflare Worker/Cloud Run proxy in front of GAS.
 * 2) The dashboard has no account-login screen as requested. A public deployment
 *    therefore grants whoever knows its URL access to exposed api* functions.
 *    Deploy privately or add a trusted gateway/access control before production.
 * 3) Set credentials in Apps Script > Project Settings > Script Properties.
 *    Never commit real tokens or API keys to GitHub or put them in index.html.
 */

var APP = {
  NAME: 'LINE AI STUDIO - ก๋วยเตี๋ยวโบราณ by เจ๊อ้น',
  VERSION: '1.0.0',
  TIMEZONE: 'Asia/Bangkok',
  DEFAULT_GEMINI_MODEL: 'gemini-3.8-flash',
  LINE_API: 'https://api.line.me',
  GEMINI_API: 'https://generativelanguage.googleapis.com/v1beta',
  IMGBB_API: 'https://api.imgbb.com/1/upload',
  MAX_LINE_MESSAGES: 5,
  MAX_MULTICAST_USERS: 500,
  MAX_UPLOAD_BYTES: 6 * 1024 * 1024,
  CACHE_SECONDS: 300,
  DEFAULT_TIMEOUT_MINUTES: 5
};

var SHEET_SCHEMAS = {
  SETTINGS: ['key', 'value', 'description', 'updated_at'],
  AI_PROMPTS: ['prompt_id', 'name', 'system_prompt', 'active', 'priority', 'updated_at'],
  PROMPT_VERSIONS: ['version_id', 'prompt_id', 'version_name', 'system_prompt', 'created_at'],
  KNOWLEDGE_BASE: ['knowledge_id', 'category', 'title', 'content', 'keywords', 'active', 'priority', 'updated_at'],
  FAQ: ['faq_id', 'question', 'answer', 'keywords', 'active', 'updated_at'],
  MENU_CATEGORIES: ['category_id', 'name', 'description', 'sort_order', 'active', 'created_at', 'updated_at'],
  MENU_ITEMS: ['item_id', 'category_id', 'name', 'description', 'price', 'options_json', 'image_url', 'image_thumb_url', 'keywords', 'available', 'sort_order', 'created_at', 'updated_at'],
  MENU_IMAGES: ['image_id', 'item_id', 'name', 'image_url', 'thumb_url', 'delete_url', 'created_at'],
  FLEX_TEMPLATES: ['template_id', 'name', 'alt_text', 'contents_json', 'active', 'created_at', 'updated_at'],
  WELCOME_SETTINGS: ['key', 'value', 'updated_at'],
  WELCOME_MESSAGES: ['message_id', 'sequence', 'message_type', 'payload_json', 'active', 'created_at', 'updated_at'],
  WELCOME_LOGS: ['log_id', 'user_id', 'status', 'message_count', 'detail', 'created_at'],
  RICH_MENU: ['richmenu_id', 'line_richmenu_id', 'name', 'richmenu_json', 'image_url', 'is_default', 'active', 'created_at', 'updated_at'],
  LINE_USERS: ['user_id', 'display_name', 'picture_url', 'status_message', 'language', 'friend_status', 'added_at', 'last_seen_at', 'tags', 'notes', 'source', 'updated_at'],
  CHAT_SESSIONS: ['user_id', 'reply_mode', 'status', 'assigned_agent', 'mode_version', 'last_message_at', 'last_message_preview', 'order_draft_json', 'handover_id', 'handover_deadline', 'timeout_sent', 'updated_at'],
  CHAT_MESSAGES: ['message_id', 'user_id', 'sender_type', 'sender_name', 'message_type', 'text', 'contents_json', 'delivery_status', 'line_message_id', 'source_event_id', 'created_at'],
  ORDERS: ['order_id', 'user_id', 'display_name', 'items_json', 'subtotal', 'service_type', 'arrival_time', 'party_count', 'note', 'status', 'confirmed_at', 'created_at', 'updated_at'],
  ORDER_ITEMS: ['order_item_id', 'order_id', 'item_id', 'item_name', 'quantity', 'unit_price', 'options', 'note'],
  ORDER_EVENTS: ['event_id', 'order_id', 'status', 'agent', 'notes', 'created_at'],
  TAGS: ['tag_id', 'name', 'color', 'created_at'],
  KEYWORD_RULES: ['rule_id', 'keyword', 'match_type', 'reply_type', 'payload_json', 'priority', 'active', 'created_at', 'updated_at'],
  AUTOMATIONS: ['automation_id', 'name', 'trigger_type', 'trigger_value', 'action_type', 'payload_json', 'active', 'created_at', 'updated_at'],
  CONVERSATION_FLOWS: ['flow_id', 'name', 'description', 'trigger_type', 'trigger_value', 'nodes_json', 'active', 'created_at', 'updated_at'],
  FLOW_SESSIONS: ['user_id', 'flow_id', 'node_index', 'answers_json', 'status', 'started_at', 'updated_at'],
  FLOW_LOGS: ['flow_log_id', 'user_id', 'flow_id', 'event', 'detail_json', 'created_at'],
  BROADCAST: ['broadcast_id', 'name', 'target_type', 'target_json', 'message_json', 'status', 'scheduled_at', 'sent_at', 'created_at', 'updated_at'],
  FLEX_SEND_LOGS: ['log_id', 'campaign_id', 'user_id', 'template_id', 'status', 'detail', 'created_at'],
  STAFF_GROUPS: ['group_id', 'group_name', 'line_group_id', 'active', 'created_at', 'updated_at'],
  ADMINS: ['agent_id', 'agent_name', 'display_name', 'active', 'created_at', 'updated_at'],
  HANDOVER_SETTINGS: ['key', 'value', 'updated_at'],
  HANDOVER_QUEUE: ['handover_id', 'user_id', 'requested_at', 'deadline_at', 'handover_status', 'assigned_agent', 'timeout_sent', 'callback_status', 'reason', 'updated_at'],
  CHAT_QUEUE: ['queue_id', 'user_id', 'payload_json', 'queue_status', 'retry_count', 'last_error', 'created_at', 'updated_at'],
  ANALYTICS: ['date', 'metric', 'value', 'detail', 'updated_at'],
  SYSTEM_LOGS: ['log_id', 'level', 'category', 'message', 'detail_json', 'created_at']
};

var DEFAULT_SETTINGS = {
  shop_name: 'ก๋วยเตี๋ยวโบราณ by เจ๊อ้น',
  shop_phone: '0626590910',
  shop_address: '',
  shop_opening_hours: '',
  ai_enabled: 'TRUE',
  ai_persona: 'เจ๊อ้น ผู้ช่วยร้านก๋วยเตี๋ยวโบราณ พูดภาษาไทยสุภาพ เป็นกันเอง อบอุ่น และกระชับ',
  ai_fallback_message: 'ขออภัยค่ะ ตอนนี้เจ๊อ้นยังไม่พบข้อมูลที่แน่ชัด ขออนุญาตให้พนักงานช่วยตรวจสอบนะคะ',
  ai_temperature: '0.4',
  ai_max_output_tokens: '700',
  ai_history_limit: '12',
  ai_show_menu_images: 'TRUE',
  ai_auto_order: 'TRUE',
  handover_keywords: 'ขอคุยกับเจ้าหน้าที่,ขอคุยกับแอดมิน,ขอคุยกับคน,ติดต่อพนักงาน,ขอเบอร์โทร,ขอคุยกับเจ้าของร้าน,เรียกพนักงาน',
  handover_timeout_minutes: '5',
  handover_auto_resume_ai: 'TRUE',
  handover_initial_message: 'ได้เลยค่ะ กำลังประสานเจ้าหน้าที่ให้ดูแลนะคะ กรุณารอสักครู่ค่ะ 🙏',
  handover_timeout_message: 'ขออภัยด้วยนะคะ 🙏 ขณะนี้ไม่มีแอดมินให้บริการ กรุณาฝากข้อความไว้ได้เลยค่ะ ทางร้านจะติดต่อกลับโดยเร็วที่สุด หรือติดต่อได้ที่ 0626590910 ขอบคุณที่ใช้บริการก๋วยเตี๋ยวโบราณ by เจ๊อ้นค่ะ ❤️',
  handover_agent_message: 'สวัสดีครับ {{agent_name}} เป็นผู้ให้บริการในวันนี้ครับ 😊 สอบถามตรงไหนดีครับ',
  handover_return_ai_message: 'ตอนนี้เจ๊อ้น AI กลับมาช่วยดูแลแล้วนะคะ สอบถามได้เลยค่ะ 😊',
  handover_offline_message: 'ขณะนี้เจ้าหน้าที่ไม่อยู่ค่ะ ฝากข้อความไว้ได้เลยนะคะ ทางร้านจะติดต่อกลับโดยเร็วที่สุด',
  staff_notify_enabled: 'TRUE',
  notify_new_follower: 'FALSE',
  welcome_enabled: 'TRUE',
  welcome_send_once: 'TRUE',
  welcome_default_alt_text: 'ยินดีต้อนรับสู่ก๋วยเตี๋ยวโบราณ by เจ๊อ้น',
  broadcast_enabled: 'TRUE',
  timezone: APP.TIMEZONE,
  default_service_type: 'takeaway'
};

var DEFAULT_WELCOME_SETTINGS = {
  enabled: 'TRUE',
  send_once: 'TRUE',
  greeting_note: 'ขอบคุณที่เพิ่มเพื่อนก๋วยเตี๋ยวโบราณ by เจ๊อ้นค่ะ'
};

var DEFAULT_HANDOVER_SETTINGS = {
  enabled: 'TRUE',
  timeout_minutes: '5',
  auto_resume_ai: 'TRUE',
  initial_message: DEFAULT_SETTINGS.handover_initial_message,
  timeout_message: DEFAULT_SETTINGS.handover_timeout_message,
  agent_message: DEFAULT_SETTINGS.handover_agent_message,
  return_ai_message: DEFAULT_SETTINGS.handover_return_ai_message,
  offline_message: DEFAULT_SETTINGS.handover_offline_message
};

/* ========================================================================== */
/* WEB APP ENTRY POINTS                                                       */
/* ========================================================================== */

function doGet(e) {
  try {
    return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle(APP.NAME)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (err) {
    logError_('WEB', 'doGet failed', { error: String(err) });
    return HtmlService.createHtmlOutput('<h2>ไม่พบไฟล์ index.html</h2><p>กรุณาเพิ่มไฟล์ index.html ในโปรเจกต์ Apps Script</p>');
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** LINE webhook URL must be: .../exec?hook=YOUR_WEBHOOK_SECRET */
function doPost(e) {
  var output;
  try {
    var props = PropertiesService.getScriptProperties();
    var expected = props.getProperty('WEBHOOK_SECRET');
    var supplied = e && e.parameter ? String(e.parameter.hook || '') : '';
    if (!expected || !supplied || supplied !== expected) {
      logWarning_('WEBHOOK', 'Rejected webhook: missing or invalid hook secret', {});
      return jsonOutput_({ ok: false, error: 'Unauthorized webhook' });
    }
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOutput_({ ok: false, error: 'Empty request body' });
    }
    var body = JSON.parse(e.postData.contents);
    var events = body.events || [];
    for (var i = 0; i < events.length; i++) {
      try {
        // Do not drop events just because another webhook is running. Event IDs
        // are deduplicated in processLineEvent_ using ScriptCache.
        processLineEvent_(events[i]);
      } catch (eventError) {
        logError_('WEBHOOK_EVENT', 'Event processing failed', { error: String(eventError), event: events[i] });
        // Re-throw so Apps Script returns an execution error instead of falsely
        // acknowledging a webhook event that was not processed.
        throw eventError;
      }
    }
    output = { ok: true, received: events.length };
  } catch (err) {
    logError_('WEBHOOK', 'doPost failed', { error: String(err) });
    throw err;
  }
  return jsonOutput_(output);
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ========================================================================== */
/* INITIALIZATION, DATABASE, SCHEMA                                           */
/* ========================================================================== */

/** Run once from Apps Script editor. Creates one spreadsheet and all tabs. */
function setupInitialize() {
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = props.getProperty('SPREADSHEET_ID');
  var ss;
  if (spreadsheetId) {
    ss = SpreadsheetApp.openById(spreadsheetId);
  } else {
    // Reuse the active spreadsheet when this Apps Script project is sheet-bound.
    // Create a new database spreadsheet only for a standalone Apps Script project.
    ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) ss = SpreadsheetApp.create(APP.NAME + ' - Database');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }
  ensureAllSheets_(ss);
  seedDefaultRows_();
  installSystemTriggers();
  logInfo_('SETUP', 'Database initialized', { spreadsheetId: ss.getId() });
  return {
    ok: true,
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    tabs: Object.keys(SHEET_SCHEMAS),
    message: 'สร้างฐานข้อมูลและหัวตารางอัตโนมัติเรียบร้อยแล้ว'
  };
}

/** Connect an existing spreadsheet by running from the Apps Script editor. */
function connectExistingSpreadsheet(spreadsheetId) {
  if (!spreadsheetId) throw new Error('กรุณาระบุ Spreadsheet ID');
  var ss = SpreadsheetApp.openById(String(spreadsheetId).trim());
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  ensureAllSheets_(ss);
  seedDefaultRows_();
  installSystemTriggers();
  return { ok: true, spreadsheetId: ss.getId(), spreadsheetUrl: ss.getUrl() };
}

function ensureAllSheets_(ss) {
  var names = Object.keys(SHEET_SCHEMAS);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var headers = SHEET_SCHEMAS[name];
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8f5e9');
      continue;
    }
    var existingCount = Math.max(sh.getLastColumn(), 1);
    var existingHeaders = sh.getRange(1, 1, 1, existingCount).getValues()[0].map(String);
    var missing = [];
    for (var h = 0; h < headers.length; h++) {
      if (existingHeaders.indexOf(headers[h]) === -1) missing.push(headers[h]);
    }
    if (missing.length) {
      var startCol = sh.getLastColumn() + 1;
      sh.getRange(1, startCol, 1, missing.length).setValues([missing]);
      sh.getRange(1, startCol, 1, missing.length).setFontWeight('bold').setBackground('#e8f5e9');
    }
    sh.setFrozenRows(1);
  }
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && defaultSheet.getLastRow() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }
  return true;
}

function seedDefaultRows_() {
  ensureSettings_('SETTINGS', DEFAULT_SETTINGS);
  ensureSettings_('WELCOME_SETTINGS', DEFAULT_WELCOME_SETTINGS);
  ensureSettings_('HANDOVER_SETTINGS', DEFAULT_HANDOVER_SETTINGS);
  var promptRows = readSheetObjects_('AI_PROMPTS');
  if (!promptRows.length) {
    appendObject_('AI_PROMPTS', {
      prompt_id: 'PROMPT_DEFAULT',
      name: 'ผู้ช่วยร้านหลัก',
      system_prompt: 'คุณคือผู้ช่วยของร้านก๋วยเตี๋ยวโบราณ by เจ๊อ้น ให้ข้อมูลตามฐานข้อมูลร้านเท่านั้น ห้ามเดาราคา เมนู เวลาทำการ หรือเงื่อนไขที่ไม่มีข้อมูล หากไม่ทราบให้แจ้งอย่างสุภาพและเสนอส่งต่อพนักงาน',
      active: 'TRUE', priority: 1, updated_at: nowIso_()
    });
  }
  if (!readSheetObjects_('TAGS').length) {
    appendObjects_('TAGS', [
      { tag_id: 'TAG_NEW', name: 'ลูกค้าใหม่', color: '#16A34A', created_at: nowIso_() },
      { tag_id: 'TAG_VIP', name: 'VIP', color: '#CA8A04', created_at: nowIso_() },
      { tag_id: 'TAG_REGULAR', name: 'ลูกค้าประจำ', color: '#2563EB', created_at: nowIso_() }
    ]);
  }
}

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
    throw new Error('ยังไม่ได้ตั้งค่าฐานข้อมูล กรุณารัน setupInitialize() ใน Apps Script Editor');
  }
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('ไม่พบ Sheet: ' + name + ' กรุณารัน setupInitialize()');
  return sh;
}

function ensureSettings_(sheetName, defaults) {
  var sh = getSheet_(sheetName);
  var rows = readSheetObjects_(sheetName);
  var existing = {};
  rows.forEach(function (r) { existing[String(r.key)] = true; });
  var toAdd = [];
  Object.keys(defaults).forEach(function (key) {
    if (!existing[key]) {
      var obj = { key: key, value: defaults[key], updated_at: nowIso_() };
      if (sheetName === 'SETTINGS') obj.description = '';
      toAdd.push(obj);
    }
  });
  if (toAdd.length) appendObjects_(sheetName, toAdd);
  return true;
}

function readSheetObjects_(sheetName) {
  var sh = getSheet_(sheetName);
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var data = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = data[0].map(function (x) { return String(x); });
  var result = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (row.join('') === '') continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = normalizeCell_(row[c]);
    result.push(obj);
  }
  return result;
}

function appendObject_(sheetName, obj) { return appendObjects_(sheetName, [obj]); }

function appendObjects_(sheetName, objects) {
  if (!objects || !objects.length) return 0;
  var sh = getSheet_(sheetName);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var values = objects.map(function (obj) {
    return headers.map(function (header) {
      var value = obj[header];
      if (value === undefined || value === null) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return value;
    });
  });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
  return values.length;
}

function upsertObject_(sheetName, keyField, obj) {
  var sh = getSheet_(sheetName);
  var values = sh.getDataRange().getValues();
  if (!values.length) throw new Error('Sheet ไม่มีหัวตาราง: ' + sheetName);
  var headers = values[0].map(String);
  var keyCol = headers.indexOf(keyField);
  if (keyCol < 0) throw new Error('ไม่พบคอลัมน์ ' + keyField + ' ใน ' + sheetName);
  var targetRow = -1;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][keyCol]) === String(obj[keyField])) { targetRow = r + 1; break; }
  }
  var rowValues = headers.map(function (header) {
    var v = obj[header];
    if (v === undefined || v === null) return targetRow > 0 ? values[targetRow - 1][headers.indexOf(header)] : '';
    return typeof v === 'object' ? JSON.stringify(v) : v;
  });
  if (targetRow > 0) sh.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, headers.length).setValues([rowValues]);
  return obj;
}

function deleteByKey_(sheetName, keyField, keyValue) {
  var sh = getSheet_(sheetName);
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return false;
  var headers = data[0].map(String);
  var col = headers.indexOf(keyField);
  if (col < 0) throw new Error('ไม่พบคอลัมน์ ' + keyField);
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][col]) === String(keyValue)) { sh.deleteRow(i + 1); return true; }
  }
  return false;
}

function normalizeCell_(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function nowIso_() { return new Date().toISOString(); }
function newId_(prefix) { return (prefix || 'ID') + '_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase(); }
function parseJson_(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (err) { return fallback; }
}
function truthy_(value) { return value === true || String(value).toUpperCase() === 'TRUE' || String(value) === '1' || String(value).toLowerCase() === 'yes'; }
function clamp_(value, min, max, fallback) { var n = Number(value); return isNaN(n) ? fallback : Math.max(min, Math.min(max, n)); }
function withScriptLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ========================================================================== */
/* SETTINGS AND CONNECTIONS                                                   */
/* ========================================================================== */

function getSetting_(key, fallback, sheetName) {
  var name = sheetName || 'SETTINGS';
  var cache = CacheService.getScriptCache();
  var cacheKey = 'setting:' + name + ':' + key;
  var cached = cache.get(cacheKey);
  if (cached !== null) return cached;
  var rows = readSheetObjects_(name);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].key) === String(key)) {
      cache.put(cacheKey, String(rows[i].value), APP.CACHE_SECONDS);
      return String(rows[i].value);
    }
  }
  return fallback;
}

function setSetting_(key, value, sheetName) {
  var name = sheetName || 'SETTINGS';
  var obj = { key: key, value: value === null || value === undefined ? '' : String(value), updated_at: nowIso_() };
  if (name === 'SETTINGS') obj.description = '';
  upsertObject_(name, 'key', obj);
  CacheService.getScriptCache().remove('setting:' + name + ':' + key);
  return obj;
}

function apiGetConnectionStatus() {
  var p = PropertiesService.getScriptProperties();
  return {
    spreadsheet: !!p.getProperty('SPREADSHEET_ID'),
    line: !!p.getProperty('LINE_CHANNEL_ACCESS_TOKEN'),
    gemini: !!p.getProperty('GEMINI_API_KEY'),
    imgbb: !!p.getProperty('IMGBB_API_KEY'),
    webhookSecret: !!p.getProperty('WEBHOOK_SECRET'),
    geminiModel: p.getProperty('GEMINI_MODEL') || APP.DEFAULT_GEMINI_MODEL,
    spreadsheetUrl: p.getProperty('SPREADSHEET_ID') ? 'https://docs.google.com/spreadsheets/d/' + p.getProperty('SPREADSHEET_ID') + '/edit' : ''
  };
}

function apiSaveSettings(settings) {
  if (!settings || typeof settings !== 'object') throw new Error('ข้อมูลตั้งค่าไม่ถูกต้อง');
  var allowed = Object.keys(DEFAULT_SETTINGS);
  var saved = 0;
  Object.keys(settings).forEach(function (key) {
    if (allowed.indexOf(key) >= 0) { setSetting_(key, settings[key]); saved++; }
  });
  CacheService.getScriptCache().removeAll(['ai:systemPrompt', 'ai:knowledge', 'menu:items']);
  return { ok: true, saved: saved };
}

function apiGetSettings() {
  var rows = readSheetObjects_('SETTINGS');
  var result = {};
  rows.forEach(function (r) { result[String(r.key)] = r.value; });
  return result;
}

function apiSetConnectionSecretStatus() { return apiGetConnectionStatus(); }

/**
 * Set credentials in Apps Script > Project Settings > Script Properties:
 * SPREADSHEET_ID, LINE_CHANNEL_ACCESS_TOKEN, GEMINI_API_KEY, GEMINI_MODEL,
 * IMGBB_API_KEY, WEBHOOK_SECRET.
 */
function setupConnectionChecklist() {
  return {
    instructions: 'เปิด Apps Script > Project Settings > Script Properties แล้วเพิ่ม key/value ที่ต้องใช้',
    required: ['LINE_CHANNEL_ACCESS_TOKEN', 'GEMINI_API_KEY', 'IMGBB_API_KEY', 'WEBHOOK_SECRET'],
    optional: ['GEMINI_MODEL'],
    note: 'SPREADSHEET_ID จะถูกตั้งให้อัตโนมัติเมื่อรัน setupInitialize()'
  };
}

/* ========================================================================== */
/* BOOTSTRAP / DASHBOARD / DIAGNOSTICS                                        */
/* ========================================================================== */

function apiGetBootstrap() {
  var stats = apiGetDashboardStats();
  return {
    app: { name: APP.NAME, version: APP.VERSION },
    stats: stats,
    settings: apiGetSettings(),
    connections: apiGetConnectionStatus(),
    menuCategories: apiListMenuCategories(),
    menuItems: apiListMenuItems({ limit: 1000 }),
    tags: apiListTags(),
    prompt: apiListPrompts(),
    flexTemplates: apiListFlexTemplates(),
    welcomeMessages: apiListWelcomeMessages(),
    handoverSettings: apiGetHandoverSettings()
  };
}

function apiGetDashboardStats() {
  var users = readSheetObjects_('LINE_USERS');
  var orders = readSheetObjects_('ORDERS');
  var messages = readSheetObjects_('CHAT_MESSAGES');
  var sessions = readSheetObjects_('CHAT_SESSIONS');
  var today = Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd');
  var newUsersToday = users.filter(function (u) { return String(u.added_at || '').substring(0, 10) === today; }).length;
  var ordersToday = orders.filter(function (o) { return String(o.created_at || '').substring(0, 10) === today; }).length;
  var waiting = sessions.filter(function (s) { return String(s.reply_mode) === 'WAITING'; }).length;
  var human = sessions.filter(function (s) { return String(s.reply_mode) === 'HUMAN'; }).length;
  return {
    totalFriends: users.filter(function (u) { return String(u.friend_status) !== 'UNFOLLOW'; }).length,
    newFriendsToday: newUsersToday,
    totalMessages: messages.length,
    ordersToday: ordersToday,
    totalOrders: orders.length,
    waitingHandover: waiting,
    humanChats: human,
    aiChats: sessions.filter(function (s) { return String(s.reply_mode || 'AI') === 'AI'; }).length
  };
}

function apiGetSystemHealth() {
  var status = apiGetConnectionStatus();
  var diag = apiGetSheetDiagnostics();
  return { ok: true, timestamp: nowIso_(), connections: status, sheets: diag, triggers: ScriptApp.getProjectTriggers().map(function (t) { return { handler: t.getHandlerFunction(), eventType: String(t.getEventType()) }; }) };
}

function apiGetSheetDiagnostics() {
  var ss = getSpreadsheet_();
  var result = [];
  Object.keys(SHEET_SCHEMAS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    result.push({ name: name, exists: !!sh, rows: sh ? Math.max(0, sh.getLastRow() - 1) : 0, columns: sh ? sh.getLastColumn() : 0, expectedColumns: SHEET_SCHEMAS[name].length });
  });
  return { spreadsheetName: ss.getName(), url: ss.getUrl(), sheets: result };
}

function apiRepairDatabaseSchema() {
  ensureAllSheets_(getSpreadsheet_());
  seedDefaultRows_();
  return apiGetSheetDiagnostics();
}

/* ========================================================================== */
/* SETTINGS DATA: PROMPTS, KNOWLEDGE, FAQ                                     */
/* ========================================================================== */

function apiListPrompts() {
  return readSheetObjects_('AI_PROMPTS').sort(function (a, b) { return Number(b.priority || 0) - Number(a.priority || 0); });
}

function apiSavePrompt(data) {
  if (!data || !data.name || !data.system_prompt) throw new Error('กรุณาระบุชื่อและ Prompt');
  var id = data.prompt_id || newId_('PROMPT');
  var obj = { prompt_id: id, name: String(data.name), system_prompt: String(data.system_prompt), active: data.active === undefined ? 'TRUE' : String(data.active), priority: Number(data.priority || 0), updated_at: nowIso_() };
  upsertObject_('AI_PROMPTS', 'prompt_id', obj);
  CacheService.getScriptCache().remove('ai:systemPrompt');
  return obj;
}

function apiDeletePrompt(promptId) { return { ok: deleteByKey_('AI_PROMPTS', 'prompt_id', promptId) }; }

function apiCreatePromptVersion(data) {
  var prompt = readSheetObjects_('AI_PROMPTS').filter(function (p) { return String(p.prompt_id) === String(data.prompt_id); })[0];
  if (!prompt) throw new Error('ไม่พบ Prompt');
  var row = { version_id: newId_('PV'), prompt_id: prompt.prompt_id, version_name: data.version_name || ('Backup ' + nowIso_()), system_prompt: prompt.system_prompt, created_at: nowIso_() };
  appendObject_('PROMPT_VERSIONS', row);
  return row;
}

function apiListPromptVersions(promptId) {
  return readSheetObjects_('PROMPT_VERSIONS').filter(function (r) { return !promptId || String(r.prompt_id) === String(promptId); }).reverse();
}

function apiRestorePromptVersion(versionId) {
  var version = readSheetObjects_('PROMPT_VERSIONS').filter(function (v) { return String(v.version_id) === String(versionId); })[0];
  if (!version) throw new Error('ไม่พบ Prompt Version');
  var prompt = readSheetObjects_('AI_PROMPTS').filter(function (p) { return String(p.prompt_id) === String(version.prompt_id); })[0];
  if (!prompt) throw new Error('ไม่พบ Prompt หลัก');
  prompt.system_prompt = version.system_prompt;
  prompt.updated_at = nowIso_();
  upsertObject_('AI_PROMPTS', 'prompt_id', prompt);
  CacheService.getScriptCache().remove('ai:systemPrompt');
  return { ok: true };
}

function apiListKnowledge(options) {
  options = options || {};
  var rows = readSheetObjects_('KNOWLEDGE_BASE');
  if (options.activeOnly) rows = rows.filter(function (r) { return truthy_(r.active); });
  if (options.category) rows = rows.filter(function (r) { return String(r.category) === String(options.category); });
  if (options.search) {
    var q = String(options.search).toLowerCase();
    rows = rows.filter(function (r) { return [r.title, r.content, r.keywords, r.category].join(' ').toLowerCase().indexOf(q) >= 0; });
  }
  return rows.sort(function (a, b) { return Number(b.priority || 0) - Number(a.priority || 0); });
}

function apiSaveKnowledge(data) {
  if (!data || !data.title || !data.content) throw new Error('กรุณาระบุหัวข้อและเนื้อหา');
  var id = data.knowledge_id || newId_('KNOW');
  var obj = { knowledge_id: id, category: data.category || 'ทั่วไป', title: String(data.title), content: String(data.content), keywords: data.keywords || '', active: data.active === undefined ? 'TRUE' : String(data.active), priority: Number(data.priority || 0), updated_at: nowIso_() };
  upsertObject_('KNOWLEDGE_BASE', 'knowledge_id', obj);
  CacheService.getScriptCache().remove('ai:knowledge');
  return obj;
}

function apiDeleteKnowledge(id) { return { ok: deleteByKey_('KNOWLEDGE_BASE', 'knowledge_id', id) }; }

function apiListFaq(options) {
  options = options || {};
  var rows = readSheetObjects_('FAQ');
  if (options.activeOnly) rows = rows.filter(function (r) { return truthy_(r.active); });
  if (options.search) {
    var q = String(options.search).toLowerCase();
    rows = rows.filter(function (r) { return [r.question, r.answer, r.keywords].join(' ').toLowerCase().indexOf(q) >= 0; });
  }
  return rows;
}

function apiSaveFaq(data) {
  if (!data || !data.question || !data.answer) throw new Error('กรุณาระบุคำถามและคำตอบ');
  var id = data.faq_id || newId_('FAQ');
  var obj = { faq_id: id, question: String(data.question), answer: String(data.answer), keywords: data.keywords || '', active: data.active === undefined ? 'TRUE' : String(data.active), updated_at: nowIso_() };
  upsertObject_('FAQ', 'faq_id', obj);
  CacheService.getScriptCache().remove('ai:knowledge');
  return obj;
}

function apiDeleteFaq(id) { return { ok: deleteByKey_('FAQ', 'faq_id', id) }; }

/* ========================================================================== */
/* MENU, CATEGORIES, IMAGES, IMGBB                                            */
/* ========================================================================== */

function apiListMenuCategories() {
  return readSheetObjects_('MENU_CATEGORIES').sort(function (a, b) { return Number(a.sort_order || 0) - Number(b.sort_order || 0); });
}

function apiSaveMenuCategory(data) {
  if (!data || !data.name) throw new Error('กรุณาระบุชื่อหมวดหมู่');
  var id = data.category_id || newId_('CAT');
  var obj = { category_id: id, name: String(data.name), description: data.description || '', sort_order: Number(data.sort_order || 0), active: data.active === undefined ? 'TRUE' : String(data.active), created_at: data.created_at || nowIso_(), updated_at: nowIso_() };
  upsertObject_('MENU_CATEGORIES', 'category_id', obj);
  CacheService.getScriptCache().remove('menu:items');
  return obj;
}

function apiDeleteMenuCategory(id) { return { ok: deleteByKey_('MENU_CATEGORIES', 'category_id', id) }; }

function apiListMenuItems(options) {
  options = options || {};
  var rows = readSheetObjects_('MENU_ITEMS');
  if (options.availableOnly) rows = rows.filter(function (r) { return truthy_(r.available); });
  if (options.category_id) rows = rows.filter(function (r) { return String(r.category_id) === String(options.category_id); });
  if (options.search) {
    var q = String(options.search).toLowerCase();
    rows = rows.filter(function (r) { return [r.name, r.description, r.keywords].join(' ').toLowerCase().indexOf(q) >= 0; });
  }
  rows.sort(function (a, b) { return Number(a.sort_order || 0) - Number(b.sort_order || 0); });
  var offset = Math.max(0, Number(options.offset || 0));
  var limit = clamp_(options.limit, 1, 1000, 1000);
  return rows.slice(offset, offset + limit).map(function (r) { r.options = parseJson_(r.options_json, []); return r; });
}

function apiSaveMenuItem(data) {
  if (!data || !data.name) throw new Error('กรุณาระบุชื่ออาหาร');
  var id = data.item_id || newId_('ITEM');
  var obj = {
    item_id: id, category_id: data.category_id || '', name: String(data.name), description: data.description || '',
    price: Number(data.price || 0), options_json: JSON.stringify(data.options || parseJson_(data.options_json, [])),
    image_url: data.image_url || '', image_thumb_url: data.image_thumb_url || '', keywords: data.keywords || '',
    available: data.available === undefined ? 'TRUE' : String(data.available), sort_order: Number(data.sort_order || 0),
    created_at: data.created_at || nowIso_(), updated_at: nowIso_()
  };
  upsertObject_('MENU_ITEMS', 'item_id', obj);
  CacheService.getScriptCache().removeAll(['menu:items', 'ai:knowledge']);
  return obj;
}

function apiDeleteMenuItem(id) { CacheService.getScriptCache().removeAll(['menu:items', 'ai:knowledge']); return { ok: deleteByKey_('MENU_ITEMS', 'item_id', id) }; }

function apiUploadImageToImgbb(fileData) {
  if (!fileData || !fileData.base64) throw new Error('ไม่พบข้อมูลรูปภาพ');
  var key = PropertiesService.getScriptProperties().getProperty('IMGBB_API_KEY');
  if (!key) throw new Error('กรุณาตั้งค่า IMGBB_API_KEY ใน Script Properties');
  var base64 = String(fileData.base64).replace(/^data:[^,]+,/, '');
  var estimatedBytes = Math.floor(base64.length * 3 / 4);
  if (estimatedBytes > APP.MAX_UPLOAD_BYTES) throw new Error('ไฟล์ใหญ่เกิน 6 MB กรุณาลดขนาดรูปก่อนอัปโหลด');
  var response = UrlFetchApp.fetch(APP.IMGBB_API + '?key=' + encodeURIComponent(key), {
    method: 'post', payload: { image: base64, name: fileData.name || ('menu-' + Date.now()) }, muteHttpExceptions: true
  });
  var result = parseJson_(response.getContentText(), {});
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || !result.data) {
    throw new Error('ImgBB Upload Error: ' + response.getContentText());
  }
  var image = {
    image_id: newId_('IMG'), item_id: fileData.item_id || '', name: fileData.name || '',
    image_url: result.data.url || result.data.display_url || '', thumb_url: result.data.thumb ? result.data.thumb.url : (result.data.medium ? result.data.medium.url : result.data.url),
    delete_url: result.data.delete_url || '', created_at: nowIso_()
  };
  appendObject_('MENU_IMAGES', image);
  return { ok: true, image: image, imgbb: { id: result.data.id, url: result.data.url, display_url: result.data.display_url } };
}

function apiListMenuImages(itemId) {
  return readSheetObjects_('MENU_IMAGES').filter(function (r) { return !itemId || String(r.item_id) === String(itemId); }).reverse();
}

/* ========================================================================== */
/* FLEX TEMPLATE BUILDER AND WELCOME MESSAGE                                 */
/* ========================================================================== */

function apiListFlexTemplates() {
  return readSheetObjects_('FLEX_TEMPLATES').map(function (r) { r.contents = parseJson_(r.contents_json, {}); return r; });
}

function apiSaveFlexTemplate(data) {
  if (!data || !data.name || !data.contents) throw new Error('กรุณาระบุชื่อและ Flex contents');
  validateFlexContents_(data.contents);
  var id = data.template_id || newId_('FLEX');
  var obj = { template_id: id, name: String(data.name), alt_text: data.alt_text || data.name, contents_json: JSON.stringify(data.contents), active: data.active === undefined ? 'TRUE' : String(data.active), created_at: data.created_at || nowIso_(), updated_at: nowIso_() };
  upsertObject_('FLEX_TEMPLATES', 'template_id', obj);
  return obj;
}

function apiDeleteFlexTemplate(id) { return { ok: deleteByKey_('FLEX_TEMPLATES', 'template_id', id) }; }

function apiValidateFlexTemplate(templateId) {
  var template = readSheetObjects_('FLEX_TEMPLATES').filter(function (r) { return String(r.template_id) === String(templateId); })[0];
  if (!template) throw new Error('ไม่พบ Flex Template');
  var message = { type: 'flex', altText: template.alt_text || template.name, contents: parseJson_(template.contents_json, {}) };
  return lineRequest_('post', '/v2/bot/message/validate/push', { messages: [message] });
}

function apiTestFlexToUser(request) {
  if (!request || !request.user_id || !request.template_id) throw new Error('กรุณาระบุผู้รับและ Flex Template');
  var template = readSheetObjects_('FLEX_TEMPLATES').filter(function (r) { return String(r.template_id) === String(request.template_id); })[0];
  if (!template) throw new Error('ไม่พบ Flex Template');
  var msg = { type: 'flex', altText: template.alt_text || template.name, contents: parseJson_(template.contents_json, {}) };
  linePush_(request.user_id, [msg]);
  return { ok: true };
}

function apiSendWelcomeTest(request) {
  if (!request || !request.user_id) throw new Error('กรุณาระบุ LINE User ID สำหรับทดสอบ');
  var messages = buildWelcomeLineMessages_();
  if (!messages.length) throw new Error('ยังไม่มีข้อความต้อนรับที่เปิดใช้งาน');
  for (var i = 0; i < messages.length; i += APP.MAX_LINE_MESSAGES) linePush_(request.user_id, messages.slice(i, i + APP.MAX_LINE_MESSAGES));
  return { ok: true, count: messages.length };
}

function validateFlexContents_(contents) {
  if (!contents || (contents.type !== 'bubble' && contents.type !== 'carousel')) throw new Error('Flex contents ต้องเป็น bubble หรือ carousel');
  if (contents.type === 'carousel' && (!contents.contents || !contents.contents.length)) throw new Error('Flex Carousel ต้องมีอย่างน้อยหนึ่ง Bubble');
  return true;
}

function apiListWelcomeMessages() {
  return readSheetObjects_('WELCOME_MESSAGES').sort(function (a, b) { return Number(a.sequence || 0) - Number(b.sequence || 0); }).map(function (r) { r.payload = parseJson_(r.payload_json, {}); return r; });
}

function apiSaveWelcomeMessages(messages, settings) {
  if (!Array.isArray(messages)) throw new Error('รายการข้อความต้อนรับไม่ถูกต้อง');
  withScriptLock_(function () {
    var sh = getSheet_('WELCOME_MESSAGES');
    if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    var rows = messages.map(function (m, index) {
      var payload = m.payload || {};
      if (m.message_type === 'flex' && payload.contents) validateFlexContents_(payload.contents);
      return { message_id: m.message_id || newId_('WELCOME'), sequence: Number(m.sequence || index + 1), message_type: m.message_type || 'text', payload_json: JSON.stringify(payload), active: m.active === undefined ? 'TRUE' : String(m.active), created_at: m.created_at || nowIso_(), updated_at: nowIso_() };
    });
    if (rows.length) appendObjects_('WELCOME_MESSAGES', rows);
  });
  if (settings) Object.keys(settings).forEach(function (k) { setSetting_(k, settings[k], 'WELCOME_SETTINGS'); });
  return { ok: true, count: messages.length };
}

function apiGetWelcomeSettings() {
  var result = {};
  Object.keys(DEFAULT_WELCOME_SETTINGS).forEach(function (k) { result[k] = DEFAULT_WELCOME_SETTINGS[k]; });
  readSheetObjects_('WELCOME_SETTINGS').forEach(function (r) { result[String(r.key)] = r.value; });
  return result;
}

function buildWelcomeLineMessages_() {
  var enabled = truthy_(getSetting_('enabled', 'TRUE', 'WELCOME_SETTINGS')) && truthy_(getSetting_('welcome_enabled', 'TRUE'));
  if (!enabled) return [];
  var items = apiListWelcomeMessages().filter(function (m) { return truthy_(m.active); });
  var messages = [];
  items.forEach(function (item) {
    var p = item.payload || {};
    if (item.message_type === 'text') {
      if (p.text) messages.push({ type: 'text', text: String(p.text).substring(0, 5000) });
    } else if (item.message_type === 'image') {
      if (isHttpsUrl_(p.originalContentUrl || p.original_content_url) && isHttpsUrl_(p.previewImageUrl || p.preview_image_url)) {
        messages.push({ type: 'image', originalContentUrl: p.originalContentUrl || p.original_content_url, previewImageUrl: p.previewImageUrl || p.preview_image_url });
      }
    } else if (item.message_type === 'flex') {
      var contents = p.contents || p;
      validateFlexContents_(contents);
      messages.push({ type: 'flex', altText: String(p.altText || p.alt_text || getSetting_('welcome_default_alt_text', APP.NAME)), contents: contents });
    } else if (item.message_type === 'video' && isHttpsUrl_(p.originalContentUrl) && isHttpsUrl_(p.previewImageUrl)) {
      messages.push({ type: 'video', originalContentUrl: p.originalContentUrl, previewImageUrl: p.previewImageUrl });
    } else if (item.message_type === 'sticker' && p.packageId && p.stickerId) {
      messages.push({ type: 'sticker', packageId: String(p.packageId), stickerId: String(p.stickerId) });
    }
  });
  return messages;
}

/* ========================================================================== */
/* LINE API CORE                                                              */
/* ========================================================================== */

function lineRequest_(method, path, body, contentType, binary) {
  var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('กรุณาตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ใน Script Properties');
  var options = {
    method: method,
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  };
  if (body !== undefined && body !== null) {
    if (binary) {
      options.contentType = contentType || 'application/octet-stream';
      options.payload = body;
    } else {
      options.contentType = contentType || 'application/json';
      options.payload = typeof body === 'string' ? body : JSON.stringify(body);
    }
  }
  var response = UrlFetchApp.fetch(APP.LINE_API + path, options);
  var code = response.getResponseCode();
  var text = response.getContentText();
  var data = parseJson_(text, { raw: text });
  if (code < 200 || code >= 300) {
    var err = new Error('LINE API ' + code + ': ' + text);
    err.statusCode = code;
    err.response = data;
    throw err;
  }
  return data;
}

function lineReply_(replyToken, messages) {
  if (!replyToken) throw new Error('ไม่มี Reply Token');
  var list = (messages || []).slice(0, APP.MAX_LINE_MESSAGES);
  if (!list.length) return { ok: true, skipped: true };
  return lineRequest_('post', '/v2/bot/message/reply', { replyToken: replyToken, messages: list });
}

function linePush_(to, messages, notificationDisabled) {
  var list = (messages || []).slice(0, APP.MAX_LINE_MESSAGES);
  if (!list.length) return { ok: true, skipped: true };
  return lineRequest_('post', '/v2/bot/message/push', { to: to, messages: list, notificationDisabled: !!notificationDisabled });
}

function lineMulticast_(userIds, messages, notificationDisabled) {
  if (!userIds || !userIds.length) throw new Error('ยังไม่ได้เลือกสมาชิก');
  if (userIds.length > APP.MAX_MULTICAST_USERS) throw new Error('Multicast รองรับไม่เกิน 500 User IDs ต่อคำขอ');
  var list = (messages || []).slice(0, APP.MAX_LINE_MESSAGES);
  return lineRequest_('post', '/v2/bot/message/multicast', { to: userIds, messages: list, notificationDisabled: !!notificationDisabled });
}

function lineStartLoading_(userId, seconds) {
  try { return lineRequest_('post', '/v2/bot/chat/loading/start', { chatId: userId, loadingSeconds: clamp_(seconds, 5, 60, 30) }); }
  catch (err) { logWarning_('LINE_LOADING', 'Unable to start loading animation', { error: String(err) }); return null; }
}

function isHttpsUrl_(value) { return /^https:\/\//i.test(String(value || '')); }

function lineGetProfile_(userId) {
  try { return lineRequest_('get', '/v2/bot/profile/' + encodeURIComponent(userId)); }
  catch (err) { logWarning_('LINE_PROFILE', 'Could not retrieve profile', { userId: userId, error: String(err) }); return null; }
}

/* ========================================================================== */
/* LINE WEBHOOK PROCESSING                                                    */
/* ========================================================================== */

function processLineEvent_(event) {
  if (!event) return;
  var eventId = event.webhookEventId || (event.message && event.message.id) || '';
  var cache = CacheService.getScriptCache();
  if (eventId && cache.get('line-event:' + eventId)) return;
  var result = null;
  if (event.type === 'follow') result = handleFollowEvent_(event);
  else if (event.type === 'unfollow') result = handleUnfollowEvent_(event);
  else if (event.type === 'message') result = handleMessageEvent_(event);
  else if (event.type === 'postback') result = handlePostbackEvent_(event);
  else if (event.type === 'join') result = handleJoinEvent_(event);
  else if (event.type === 'leave') result = handleLeaveEvent_(event);
  // Write the deduplication marker only after the handler completed. If it throws,
  // LINE can retry the event without our cache suppressing that retry.
  if (eventId) cache.put('line-event:' + eventId, '1', 21600);
  return result;
}

function handleFollowEvent_(event) {
  var userId = event.source && event.source.userId;
  if (!userId) return;
  var profile = lineGetProfile_(userId) || {};
  upsertLineUser_(userId, profile, 'FOLLOW_WEBHOOK');
  ensureChatSession_(userId);
  var sendOnce = truthy_(getSetting_('send_once', getSetting_('welcome_send_once', 'TRUE'), 'WELCOME_SETTINGS'));
  var previousWelcome = readSheetObjects_('WELCOME_LOGS').some(function (r) { return String(r.user_id) === String(userId) && (r.status === 'SENT' || r.status === 'SENT_BY_PUSH'); });
  var messages = sendOnce && previousWelcome ? [] : buildWelcomeLineMessages_();
  var log = { log_id: newId_('WLOG'), user_id: userId, status: 'NO_MESSAGE', message_count: messages.length, detail: '', created_at: nowIso_() };
  var deliveredCount = 0;
  try {
    if (messages.length && event.replyToken) {
      var firstBatch = messages.slice(0, APP.MAX_LINE_MESSAGES);
      lineReply_(event.replyToken, firstBatch);
      deliveredCount = firstBatch.length;
      for (var i = deliveredCount; i < messages.length; i += APP.MAX_LINE_MESSAGES) {
        var nextBatch = messages.slice(i, i + APP.MAX_LINE_MESSAGES);
        linePush_(userId, nextBatch);
        deliveredCount += nextBatch.length;
      }
      log.status = 'SENT';
    } else if (messages.length) {
      for (var j = 0; j < messages.length; j += APP.MAX_LINE_MESSAGES) {
        var pushBatch = messages.slice(j, j + APP.MAX_LINE_MESSAGES);
        linePush_(userId, pushBatch);
        deliveredCount += pushBatch.length;
      }
      log.status = 'SENT_BY_PUSH';
    }
  } catch (err) {
    log.status = deliveredCount > 0 ? 'PARTIAL' : 'FAILED';
    log.detail = String(err);
    logError_('WELCOME', 'Welcome message send failed', { userId: userId, deliveredCount: deliveredCount, total: messages.length, error: String(err) });
    // Retry only the not-yet-confirmed tail. Never resend the first reply batch
    // merely because a later push batch failed.
    for (var retryAt = deliveredCount; retryAt < messages.length; retryAt += APP.MAX_LINE_MESSAGES) {
      var retryBatch = messages.slice(retryAt, retryAt + APP.MAX_LINE_MESSAGES);
      try { linePush_(userId, retryBatch); deliveredCount += retryBatch.length; }
      catch (pushErr) { log.detail += ' | Push retry: ' + String(pushErr); break; }
    }
    if (deliveredCount === messages.length && messages.length) log.status = 'SENT_BY_PUSH';
  }
  appendObject_('WELCOME_LOGS', log);
  analyticsIncrement_('new_follow', 1);
  notifyStaffNewFollower_(userId, profile.displayName || 'ลูกค้าใหม่');
  processAutomations_('FOLLOW', { user_id: userId, display_name: profile.displayName || 'ลูกค้าใหม่' });
  // Follow-trigger conversation flows use Push because the welcome reply token
  // may already have been consumed by the welcome message batch.
  processConversationFlows_(userId, '', null, 'FOLLOW');
}

function handleUnfollowEvent_(event) {
  var userId = event.source && event.source.userId;
  if (!userId) return;
  var user = getLineUser_(userId) || { user_id: userId };
  user.friend_status = 'UNFOLLOW'; user.updated_at = nowIso_();
  upsertObject_('LINE_USERS', 'user_id', user);
  logInfo_('LINE', 'User unfollowed', { userId: userId });
}

function handleMessageEvent_(event) {
  var userId = event.source && event.source.userId;
  if (!userId || !event.message) return;
  var message = event.message;
  var text = message.type === 'text' ? String(message.text || '') : '[' + message.type + ']';
  var user = getLineUser_(userId);
  if (!user) {
    var profile = lineGetProfile_(userId) || {};
    upsertLineUser_(userId, profile, 'MESSAGE_WEBHOOK');
    user = getLineUser_(userId) || { user_id: userId };
  }
  user.last_seen_at = nowIso_(); user.updated_at = nowIso_();
  upsertObject_('LINE_USERS', 'user_id', user);
  appendChatMessage_(userId, 'USER', user.display_name || 'ลูกค้า', message.type, text, message, 'RECEIVED', event.webhookEventId || message.id);
  touchChatSession_(userId, text);

  var session = ensureChatSession_(userId);
  if (session.reply_mode === 'HUMAN' || session.reply_mode === 'PAUSED') {
    notifyStaffIncomingMessage_(userId, user.display_name || 'ลูกค้า', text);
    return;
  }
  if (session.reply_mode === 'WAITING') {
    // Keep the customer in the handover queue; do not restart AI while an agent is being requested.
    return;
  }

  if (message.type !== 'text') {
    if (truthy_(getSetting_('ai_enabled', 'TRUE'))) {
      var nonTextReply = 'ได้รับข้อความแล้วค่ะ หากต้องการสอบถามเมนูหรือสั่งอาหาร พิมพ์ข้อความบอกเจ๊อ้นได้เลยนะคะ 😊';
      sendReplyOrPush_(event.replyToken, userId, [{ type: 'text', text: nonTextReply }]);
      appendChatMessage_(userId, 'AI', 'เจ๊อ้น AI', 'text', nonTextReply, {}, 'SENT', event.webhookEventId || '');
    }
    return;
  }

  if (isHandoverRequest_(text)) {
    createHandoverRequest_(userId, event.replyToken, text, user.display_name || 'ลูกค้า');
    return;
  }

  if (processConversationFlows_(userId, text, event.replyToken, 'MESSAGE')) return;

  var keywordResult = processKeywordRules_(userId, text);
  if (keywordResult && keywordResult.handled) {
    sendReplyOrPush_(event.replyToken, userId, keywordResult.messages);
    keywordResult.messages.forEach(function (m) { appendChatMessage_(userId, 'BOT', 'ระบบอัตโนมัติ', m.type, m.text || '[Flex]', m, 'SENT', event.webhookEventId || ''); });
    return;
  }

  if (processAutomations_('KEYWORD', { user_id: userId, text: text, reply_token: event.replyToken, display_name: user.display_name || 'ลูกค้า' })) return;

  if (!truthy_(getSetting_('ai_enabled', 'TRUE'))) return;
  var aiModeVersion = Number(session.mode_version || 0);
  lineStartLoading_(userId, 45);
  try {
    var ai = generateGeminiReply_(userId, text);
    if (String(ai.intent || '').toLowerCase() === 'handover') {
      createHandoverRequest_(userId, event.replyToken, text, user.display_name || 'ลูกค้า');
      return;
    }
    var replyMessages = [];
    if (ai.reply) replyMessages.push({ type: 'text', text: String(ai.reply).substring(0, 5000) });
    if (ai.menu_item_ids && ai.menu_item_ids.length && truthy_(getSetting_('ai_show_menu_images', 'TRUE'))) {
      var menuFlex = buildMenuFlexMessage_(ai.menu_item_ids);
      if (menuFlex) replyMessages.push(menuFlex);
    }
    if (!replyMessages.length) replyMessages.push({ type: 'text', text: getSetting_('ai_fallback_message', DEFAULT_SETTINGS.ai_fallback_message) });
    if (ai.order && ai.order.ready_to_confirm && replyMessages.length < APP.MAX_LINE_MESSAGES) {
      var confirmFlex = buildOrderDraftConfirmFlex_(userId);
      if (confirmFlex) replyMessages.push(confirmFlex);
    }
    // Re-check state: admin may take over while Gemini is generating.
    var latestSession = ensureChatSession_(userId);
    if (latestSession.reply_mode !== 'AI' || Number(latestSession.mode_version || 0) !== aiModeVersion) return;
    sendReplyOrPush_(event.replyToken, userId, replyMessages);
    replyMessages.forEach(function (m) { appendChatMessage_(userId, 'AI', 'เจ๊อ้น AI', m.type, m.text || '[Flex Message]', m, 'SENT', event.webhookEventId || ''); });
    analyticsIncrement_('ai_reply', 1);
  } catch (err) {
    logError_('GEMINI', 'AI response failed', { userId: userId, error: String(err) });
    // Do not send a delayed AI fallback if a human has taken over meanwhile.
    var errorSession = ensureChatSession_(userId);
    if (errorSession.reply_mode !== 'AI' || Number(errorSession.mode_version || 0) !== aiModeVersion) return;
    var fallback = getSetting_('ai_fallback_message', DEFAULT_SETTINGS.ai_fallback_message);
    try { sendReplyOrPush_(event.replyToken, userId, [{ type: 'text', text: fallback }]); } catch (sendErr) { logError_('LINE_REPLY', 'Fallback send failed', { error: String(sendErr) }); }
  }
}

function handlePostbackEvent_(event) {
  var userId = event.source && event.source.userId;
  var data = event.postback && event.postback.data ? String(event.postback.data) : '';
  if (!userId || !data) return;
  var parsed = parseQueryString_(data);
  if (parsed.action === 'order_confirm') {
    confirmOrderDraft_(userId, event.replyToken);
  } else if (parsed.action === 'order_cancel') {
    clearOrderDraft_(userId);
    sendReplyOrPush_(event.replyToken, userId, [{ type: 'text', text: 'ยกเลิกร่างรายการสั่งอาหารเรียบร้อยแล้วค่ะ' }]);
  } else if (parsed.action === 'menu_item') {
    var item = getMenuItem_(parsed.id);
    if (item) sendReplyOrPush_(event.replyToken, userId, [{ type: 'text', text: 'สนใจ ' + item.name + ' ใช่ไหมคะ ต้องการกี่ที่คะ?' }]);
  } else if (parsed.action === 'order_status' && parsed.order_id && parsed.status) {
    var staff = event.source && event.source.userId ? (lineGetProfile_(event.source.userId) || {}) : {};
    var staffName = staff.displayName || 'พนักงาน';
    apiUpdateOrderStatus({ order_id: parsed.order_id, status: parsed.status, agent_name: staffName, notify_customer: true });
    sendReplyOrPush_(event.replyToken, userId, [{ type: 'text', text: 'อัปเดตออเดอร์ ' + parsed.order_id + ' เป็น ' + parsed.status + ' เรียบร้อยแล้วค่ะ' }]);
  }
}

function handleJoinEvent_(event) {
  var source = event.source || {};
  if (source.groupId) {
    var found = readSheetObjects_('STAFF_GROUPS').filter(function (g) { return String(g.line_group_id) === String(source.groupId); })[0];
    if (!found) appendObject_('STAFF_GROUPS', { group_id: newId_('GROUP'), group_name: 'LINE Group (ตั้งชื่อใน Dashboard)', line_group_id: source.groupId, active: 'TRUE', created_at: nowIso_(), updated_at: nowIso_() });
  }
  logInfo_('LINE_GROUP', 'Bot joined a group/room', { source: source });
}
function handleLeaveEvent_(event) { logInfo_('LINE_GROUP', 'Bot left a group/room', { source: event.source || {} }); }

function sendReplyOrPush_(replyToken, userId, messages) {
  if (replyToken) {
    try { return lineReply_(replyToken, messages); }
    catch (err) {
      logWarning_('LINE_REPLY', 'Reply failed; falling back to push', { userId: userId, error: String(err) });
    }
  }
  return linePush_(userId, messages.slice(0, APP.MAX_LINE_MESSAGES));
}

function parseQueryString_(value) {
  var out = {};
  String(value).split('&').forEach(function (part) {
    var p = part.split('='); out[decodeURIComponent(p[0] || '')] = decodeURIComponent(p.slice(1).join('=') || '');
  });
  return out;
}

/* ========================================================================== */
/* LINE USERS / FRIENDS MANAGER                                               */
/* ========================================================================== */

function upsertLineUser_(userId, profile, source) {
  var old = getLineUser_(userId) || {};
  var obj = {
    user_id: userId,
    display_name: profile.displayName || old.display_name || 'LINE User',
    picture_url: profile.pictureUrl || old.picture_url || '',
    status_message: profile.statusMessage || old.status_message || '',
    language: profile.language || old.language || '',
    friend_status: 'FOLLOW',
    added_at: old.added_at || nowIso_(),
    last_seen_at: nowIso_(),
    tags: old.tags || 'ลูกค้าใหม่', notes: old.notes || '', source: source || old.source || '', updated_at: nowIso_()
  };
  upsertObject_('LINE_USERS', 'user_id', obj);
  return obj;
}

function getLineUser_(userId) {
  var sh = getSheet_('LINE_USERS');
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  var finder = sh.getRange(2, 1, lastRow - 1, 1).createTextFinder(String(userId)).matchEntireCell(true);
  var cell = finder.findNext();
  if (!cell) return null;
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var row = sh.getRange(cell.getRow(), 1, 1, headers.length).getValues()[0];
  var obj = {};
  headers.forEach(function (h, i) { obj[h] = normalizeCell_(row[i]); });
  return obj;
}

function apiListMembers(options) {
  options = options || {};
  var rows = readSheetObjects_('LINE_USERS');
  if (options.status && options.status !== 'ALL') rows = rows.filter(function (r) { return String(r.friend_status) === String(options.status); });
  if (options.tag) rows = rows.filter(function (r) { return String(r.tags || '').split(',').indexOf(String(options.tag)) >= 0; });
  if (options.search) {
    var q = String(options.search).toLowerCase();
    rows = rows.filter(function (r) { return [r.display_name, r.user_id, r.notes, r.tags].join(' ').toLowerCase().indexOf(q) >= 0; });
  }
  rows.sort(function (a, b) { return String(b.added_at || '').localeCompare(String(a.added_at || '')); });
  var total = rows.length;
  var offset = Math.max(0, Number(options.offset || 0));
  var limit = clamp_(options.limit, 1, 500, 50);
  return { rows: rows.slice(offset, offset + limit), total: total, offset: offset, limit: limit };
}

function apiGetMember(userId) { return getLineUser_(userId); }

function apiUpdateMember(data) {
  if (!data || !data.user_id) throw new Error('ไม่พบ User ID');
  var user = getLineUser_(data.user_id);
  if (!user) throw new Error('ไม่พบสมาชิก');
  if (data.tags !== undefined) user.tags = Array.isArray(data.tags) ? data.tags.join(',') : String(data.tags);
  if (data.notes !== undefined) user.notes = String(data.notes);
  if (data.display_name !== undefined) user.display_name = String(data.display_name);
  user.updated_at = nowIso_();
  upsertObject_('LINE_USERS', 'user_id', user);
  return user;
}

/** Sync follower IDs. This endpoint is available only to LINE verified/premium OA. */
function apiSyncFollowers(options) {
  options = options || {};
  var maxPages = clamp_(options.maxPages, 1, 5, 1);
  var limit = clamp_(options.limit, 1, 1000, 1000);
  var start = options.start || '';
  var all = [];
  var next = start;
  for (var page = 0; page < maxPages; page++) {
    var path = '/v2/bot/followers/ids?limit=' + limit;
    if (next) path += '&start=' + encodeURIComponent(next);
    var res = lineRequest_('get', path);
    var ids = res.userIds || [];
    ids.forEach(function (id) { all.push(id); });
    next = res.next || '';
    if (!next) break;
  }
  var existing = {};
  readSheetObjects_('LINE_USERS').forEach(function (r) { existing[String(r.user_id)] = r; });
  var toAdd = [];
  all.forEach(function (id) {
    if (!existing[id]) {
      toAdd.push({ user_id: id, display_name: 'LINE User', picture_url: '', status_message: '', language: '', friend_status: 'FOLLOW', added_at: nowIso_(), last_seen_at: '', tags: 'ลูกค้าใหม่', notes: '', source: 'FOLLOWERS_SYNC', updated_at: nowIso_() });
    }
  });
  if (toAdd.length) appendObjects_('LINE_USERS', toAdd);
  return { ok: true, syncedIds: all.length, newMembers: toAdd.length, next: next || null, message: 'หากมี next token ให้กด Sync ต่อเพื่อดึงหน้าถัดไป' };
}

function apiEnrichMemberProfiles(options) {
  options = options || {};
  var limit = clamp_(options.limit, 1, 50, 20);
  var rows = readSheetObjects_('LINE_USERS').filter(function (r) { return r.friend_status !== 'UNFOLLOW' && (!r.display_name || r.display_name === 'LINE User'); }).slice(0, limit);
  var success = 0;
  rows.forEach(function (r) {
    var p = lineGetProfile_(r.user_id);
    if (p) { upsertLineUser_(r.user_id, p, 'PROFILE_SYNC'); success++; }
  });
  return { ok: true, processed: rows.length, enriched: success };
}

function apiRefreshMemberProfile(userId) {
  var profile = lineGetProfile_(userId);
  if (!profile) return { ok: false, error: 'LINE ไม่สามารถดึงโปรไฟล์นี้ได้ อาจถูกบล็อกหรือไม่มีสิทธิ์เข้าถึง' };
  return upsertLineUser_(userId, profile, 'MANUAL_PROFILE_REFRESH');
}

function apiListTags() { return readSheetObjects_('TAGS'); }
function apiSaveTag(data) {
  if (!data || !data.name) throw new Error('กรุณาระบุชื่อ Tag');
  var id = data.tag_id || newId_('TAG');
  var obj = { tag_id: id, name: String(data.name), color: data.color || '#16A34A', created_at: data.created_at || nowIso_() };
  upsertObject_('TAGS', 'tag_id', obj); return obj;
}
function apiDeleteTag(id) { return { ok: deleteByKey_('TAGS', 'tag_id', id) }; }

/* ========================================================================== */
/* BROADCAST / SELECT FRIENDS AND SEND FLEX                                   */
/* ========================================================================== */

function apiSendFlexToMembers(request) {
  if (!request) throw new Error('ข้อมูลส่ง Flex ไม่ถูกต้อง');
  var template = readSheetObjects_('FLEX_TEMPLATES').filter(function (r) { return String(r.template_id) === String(request.template_id); })[0];
  if (!template) throw new Error('ไม่พบ Flex Template');
  var contents = parseJson_(template.contents_json, null);
  validateFlexContents_(contents);
  var userIds = (request.user_ids || []).map(String).filter(function (id, idx, arr) { return id && arr.indexOf(id) === idx; });
  if (!userIds.length) throw new Error('กรุณาเลือกเพื่อนอย่างน้อย 1 คน');
  var message = { type: 'flex', altText: template.alt_text || template.name, contents: contents };
  var campaignId = newId_('CAMPAIGN');
  var logs = [];
  for (var i = 0; i < userIds.length; i += APP.MAX_MULTICAST_USERS) {
    var chunk = userIds.slice(i, i + APP.MAX_MULTICAST_USERS);
    try {
      lineMulticast_(chunk, [message], !!request.notification_disabled);
      chunk.forEach(function (id) { logs.push({ log_id: newId_('FLOG'), campaign_id: campaignId, user_id: id, template_id: template.template_id, status: 'SENT', detail: '', created_at: nowIso_() }); });
    } catch (err) {
      chunk.forEach(function (id) { logs.push({ log_id: newId_('FLOG'), campaign_id: campaignId, user_id: id, template_id: template.template_id, status: 'FAILED', detail: String(err), created_at: nowIso_() }); });
    }
  }
  appendObjects_('FLEX_SEND_LOGS', logs);
  appendObject_('BROADCAST', { broadcast_id: campaignId, name: request.name || template.name, target_type: 'SELECTED_USERS', target_json: JSON.stringify(userIds), message_json: JSON.stringify(message), status: logs.every(function (l) { return l.status === 'SENT'; }) ? 'SENT' : 'PARTIAL_OR_FAILED', scheduled_at: '', sent_at: nowIso_(), created_at: nowIso_() });
  return { ok: true, campaign_id: campaignId, total: userIds.length, sent: logs.filter(function (l) { return l.status === 'SENT'; }).length, failed: logs.filter(function (l) { return l.status !== 'SENT'; }).length };
}


function apiSendDirectMessage(request) {
  if (!request || !request.user_id || !request.message) throw new Error('กรุณาระบุผู้รับและข้อความ');
  var message = request.message;
  if (message.type === 'flex') validateFlexContents_(message.contents);
  if (message.type === 'image' && (!isHttpsUrl_(message.originalContentUrl) || !isHttpsUrl_(message.previewImageUrl))) throw new Error('URL รูปภาพต้องเป็น HTTPS');
  linePush_(request.user_id, [message]);
  appendChatMessage_(request.user_id, request.sender_type || 'AGENT', request.sender_name || 'เจ้าหน้าที่', message.type, message.text || '[ข้อความสื่อ]', message, 'SENT', '');
  return { ok: true };
}

function apiSendMessageToMembers(request) {
  if (!request || !request.user_ids || !request.user_ids.length || !request.messages || !request.messages.length) throw new Error('กรุณาระบุสมาชิกและข้อความ');
  var userIds = request.user_ids.map(String);
  var messages = request.messages.slice(0, APP.MAX_LINE_MESSAGES);
  var results = [];
  for (var i = 0; i < userIds.length; i += APP.MAX_MULTICAST_USERS) {
    var chunk = userIds.slice(i, i + APP.MAX_MULTICAST_USERS);
    try { lineMulticast_(chunk, messages, !!request.notification_disabled); results.push({ count: chunk.length, status: 'SENT' }); }
    catch (err) { results.push({ count: chunk.length, status: 'FAILED', error: String(err) }); }
  }
  return { ok: results.every(function (r) { return r.status === 'SENT'; }), results: results };
}

function apiGetBroadcastLogs(options) {
  options = options || {};
  var rows = readSheetObjects_('FLEX_SEND_LOGS').reverse();
  if (options.campaign_id) rows = rows.filter(function (r) { return String(r.campaign_id) === String(options.campaign_id); });
  return rows.slice(0, clamp_(options.limit, 1, 1000, 100));
}

/* ========================================================================== */
/* LIVE CHAT / HUMAN HANDOVER                                                 */
/* ========================================================================== */

function ensureChatSession_(userId) {
  var rows = readSheetObjects_('CHAT_SESSIONS');
  for (var i = 0; i < rows.length; i++) if (String(rows[i].user_id) === String(userId)) return rows[i];
  var obj = { user_id: userId, reply_mode: 'AI', status: 'OPEN', assigned_agent: '', mode_version: 1, last_message_at: nowIso_(), last_message_preview: '', order_draft_json: '{}', handover_id: '', handover_deadline: '', timeout_sent: 'FALSE', updated_at: nowIso_() };
  appendObject_('CHAT_SESSIONS', obj);
  return obj;
}

function touchChatSession_(userId, preview) {
  var s = ensureChatSession_(userId);
  s.last_message_at = nowIso_(); s.last_message_preview = String(preview || '').substring(0, 200); s.updated_at = nowIso_();
  upsertObject_('CHAT_SESSIONS', 'user_id', s);
}

function appendChatMessage_(userId, senderType, senderName, messageType, text, contents, status, sourceEventId) {
  var obj = { message_id: newId_('MSG'), user_id: userId, sender_type: senderType, sender_name: senderName || '', message_type: messageType || 'text', text: text || '', contents_json: JSON.stringify(contents || {}), delivery_status: status || '', line_message_id: '', source_event_id: sourceEventId || '', created_at: nowIso_() };
  appendObject_('CHAT_MESSAGES', obj);
  return obj;
}

function apiGetLiveChats(options) {
  options = options || {};
  var sessions = readSheetObjects_('CHAT_SESSIONS');
  var users = {};
  readSheetObjects_('LINE_USERS').forEach(function (u) { users[u.user_id] = u; });
  if (options.mode && options.mode !== 'ALL') sessions = sessions.filter(function (s) { return String(s.reply_mode) === String(options.mode); });
  if (options.search) {
    var q = String(options.search).toLowerCase();
    sessions = sessions.filter(function (s) { var u = users[s.user_id] || {}; return [u.display_name, s.last_message_preview, s.user_id].join(' ').toLowerCase().indexOf(q) >= 0; });
  }
  sessions.sort(function (a, b) { return String(b.last_message_at || '').localeCompare(String(a.last_message_at || '')); });
  return sessions.map(function (s) { s.user = users[s.user_id] || {}; return s; }).slice(0, clamp_(options.limit, 1, 500, 100));
}

function apiGetChatHistory(userId, options) {
  options = options || {};
  var rows = readSheetObjects_('CHAT_MESSAGES').filter(function (m) { return String(m.user_id) === String(userId); });
  rows.sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
  var limit = clamp_(options.limit, 1, 500, 100);
  return rows.slice(Math.max(0, rows.length - limit)).map(function (r) { r.contents = parseJson_(r.contents_json, {}); return r; });
}

function apiTakeoverChat(request) {
  if (!request || !request.user_id) throw new Error('ไม่พบ user_id');
  var userId = request.user_id;
  var agent = request.agent_name || 'เจ้าหน้าที่';
  var alreadyAssigned = false;
  var session = withScriptLock_(function () {
    var current = ensureChatSession_(userId);
    if (current.reply_mode === 'HUMAN' && current.assigned_agent === agent) {
      alreadyAssigned = true;
      return current;
    }
    current.reply_mode = 'HUMAN'; current.status = 'OPEN'; current.assigned_agent = agent; current.mode_version = Number(current.mode_version || 0) + 1; current.updated_at = nowIso_();
    if (current.handover_id) markHandoverAccepted_(current.handover_id, agent);
    current.handover_id = ''; current.handover_deadline = ''; current.timeout_sent = 'FALSE';
    upsertObject_('CHAT_SESSIONS', 'user_id', current);
    return current;
  });
  if (alreadyAssigned) return { ok: true, alreadyAssigned: true, mode: 'HUMAN', assigned_agent: agent, mode_version: session.mode_version };
  var template = getSetting_('handover_agent_message', DEFAULT_SETTINGS.handover_agent_message);
  var msg = template.replace(/\{\{agent_name\}\}/g, agent);
  if (request.send_notice !== false) {
    try { linePush_(userId, [{ type: 'text', text: msg }]); appendChatMessage_(userId, 'AGENT', agent, 'text', msg, {}, 'SENT', ''); }
    catch (err) { logError_('HANDOVER', 'Agent notice failed', { userId: userId, error: String(err) }); }
  }
  logInfo_('HANDOVER', 'Chat taken over by agent', { userId: userId, agent: agent });
  return { ok: true, mode: 'HUMAN', assigned_agent: agent, mode_version: session.mode_version };
}

function apiSetChatMode(request) {
  if (!request || !request.user_id) throw new Error('ไม่พบ user_id');
  if (String(request.mode).toUpperCase() === 'HUMAN') return apiTakeoverChat(request);
  if (String(request.mode).toUpperCase() === 'AI') return apiReturnChatToAI(request);
  if (String(request.mode).toUpperCase() === 'PAUSED') return apiPauseChat(request);
  throw new Error('โหมดไม่ถูกต้อง');
}

function apiPauseChat(request) {
  var s = ensureChatSession_(request.user_id);
  s.reply_mode = 'PAUSED'; s.assigned_agent = request.agent_name || s.assigned_agent || ''; s.mode_version = Number(s.mode_version || 0) + 1; s.updated_at = nowIso_();
  upsertObject_('CHAT_SESSIONS', 'user_id', s);
  return { ok: true, mode: 'PAUSED' };
}

function apiCloseChat(request) {
  if (!request || !request.user_id) throw new Error('ไม่พบ user_id');
  var s = ensureChatSession_(request.user_id);
  s.status = 'CLOSED'; s.reply_mode = 'PAUSED'; s.assigned_agent = request.agent_name || s.assigned_agent || '';
  s.handover_id = ''; s.handover_deadline = ''; s.timeout_sent = 'FALSE';
  s.mode_version = Number(s.mode_version || 0) + 1; s.updated_at = nowIso_();
  upsertObject_('CHAT_SESSIONS', 'user_id', s);
  return { ok: true, status: 'CLOSED', mode: 'PAUSED', mode_version: s.mode_version };
}

function apiReopenChat(request) {
  if (!request || !request.user_id) throw new Error('ไม่พบ user_id');
  var s = ensureChatSession_(request.user_id);
  s.status = 'OPEN'; s.reply_mode = request.mode === 'HUMAN' ? 'HUMAN' : 'AI';
  if (s.reply_mode === 'HUMAN') s.assigned_agent = request.agent_name || 'เจ้าหน้าที่';
  else s.assigned_agent = '';
  s.mode_version = Number(s.mode_version || 0) + 1; s.updated_at = nowIso_();
  upsertObject_('CHAT_SESSIONS', 'user_id', s);
  return { ok: true, status: 'OPEN', mode: s.reply_mode, mode_version: s.mode_version };
}

function apiReturnChatToAI(request) {
  var userId = request.user_id;
  var s = ensureChatSession_(userId);
  s.reply_mode = 'AI'; s.status = 'OPEN'; s.assigned_agent = ''; s.mode_version = Number(s.mode_version || 0) + 1; s.handover_id = ''; s.handover_deadline = ''; s.timeout_sent = 'FALSE'; s.updated_at = nowIso_();
  upsertObject_('CHAT_SESSIONS', 'user_id', s);
  if (request.send_notice !== false) {
    var msg = getSetting_('handover_return_ai_message', DEFAULT_SETTINGS.handover_return_ai_message);
    try { linePush_(userId, [{ type: 'text', text: msg }]); appendChatMessage_(userId, 'BOT', 'เจ๊อ้น AI', 'text', msg, {}, 'SENT', ''); } catch (err) { logError_('HANDOVER', 'Return-to-AI notice failed', { userId: userId, error: String(err) }); }
  }
  return { ok: true, mode: 'AI', mode_version: s.mode_version };
}

function apiSendAgentMessage(request) {
  if (!request || !request.user_id || !String(request.text || '').trim()) throw new Error('กรุณาระบุข้อความ');
  var userId = request.user_id;
  var session = ensureChatSession_(userId);
  if (session.reply_mode !== 'HUMAN') throw new Error('ห้องแชทนี้ไม่ได้อยู่ในโหมดแอดมิน กรุณากดรับช่วงก่อนส่งข้อความ');
  var messageId = request.client_message_id || newId_('CLIENTMSG');
  if (CacheService.getScriptCache().get('agent-send:' + messageId)) return { ok: true, duplicate: true, client_message_id: messageId };
  var text = String(request.text).substring(0, 5000);
  linePush_(userId, [{ type: 'text', text: text }]);
  CacheService.getScriptCache().put('agent-send:' + messageId, '1', 21600);
  var agent = request.agent_name || session.assigned_agent || 'เจ้าหน้าที่';
  var record = appendChatMessage_(userId, 'AGENT', agent, 'text', text, { client_message_id: messageId }, 'SENT', '');
  touchChatSession_(userId, text);
  return { ok: true, client_message_id: messageId, message_id: record.message_id, status: 'SENT' };
}

function apiSendAgentFlex(request) {
  if (!request || !request.user_id || !request.template_id) throw new Error('ข้อมูลไม่ครบ');
  var s = ensureChatSession_(request.user_id);
  if (s.reply_mode !== 'HUMAN') throw new Error('กรุณารับช่วงสนทนาก่อนส่ง Flex');
  var t = readSheetObjects_('FLEX_TEMPLATES').filter(function (r) { return String(r.template_id) === String(request.template_id); })[0];
  if (!t) throw new Error('ไม่พบ Template');
  var msg = { type: 'flex', altText: t.alt_text || t.name, contents: parseJson_(t.contents_json, {}) };
  linePush_(request.user_id, [msg]);
  appendChatMessage_(request.user_id, 'AGENT', request.agent_name || s.assigned_agent || 'เจ้าหน้าที่', 'flex', '[Flex Message] ' + t.name, msg, 'SENT', '');
  return { ok: true };
}

/* ========================================================================== */
/* HANDOVER DETECTION / QUEUE / TIMEOUT                                       */
/* ========================================================================== */

function isHandoverRequest_(text) {
  if (!truthy_(getSetting_('enabled', 'TRUE', 'HANDOVER_SETTINGS'))) return false;
  var keywords = getSetting_('handover_keywords', DEFAULT_SETTINGS.handover_keywords).split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(String);
  var value = String(text || '').toLowerCase();
  return keywords.some(function (k) { return k && value.indexOf(k) >= 0; });
}

function createHandoverRequest_(userId, replyToken, reason, displayName) {
  var outcome = withScriptLock_(function () {
    var session = ensureChatSession_(userId);
    if (session.reply_mode === 'HUMAN') return { kind: 'already_human', session: session };
    if (session.reply_mode === 'WAITING' && session.handover_id) return { kind: 'already_waiting', session: session };

    var minutes = clamp_(getSetting_('timeout_minutes', getSetting_('handover_timeout_minutes', '5', 'HANDOVER_SETTINGS'), 'HANDOVER_SETTINGS'), 1, 60, APP.DEFAULT_TIMEOUT_MINUTES);
    var deadline = new Date(Date.now() + minutes * 60000).toISOString();
    var id = newId_('HANDOVER');
    var row = { handover_id: id, user_id: userId, requested_at: nowIso_(), deadline_at: deadline, handover_status: 'WAITING', assigned_agent: '', timeout_sent: 'FALSE', callback_status: 'PENDING', reason: String(reason || ''), updated_at: nowIso_() };
    appendObject_('HANDOVER_QUEUE', row);
    session.reply_mode = 'WAITING'; session.status = 'WAITING_AGENT'; session.handover_id = id; session.handover_deadline = deadline; session.timeout_sent = 'FALSE'; session.mode_version = Number(session.mode_version || 0) + 1; session.updated_at = nowIso_();
    upsertObject_('CHAT_SESSIONS', 'user_id', session);
    return { kind: 'created', handover_id: id, deadline_at: deadline, session: session };
  });

  if (outcome.kind === 'already_human') return { ok: true, alreadyHuman: true };
  if (outcome.kind === 'already_waiting') {
    sendReplyOrPush_(replyToken, userId, [{ type: 'text', text: 'ได้รับคำขอแล้วค่ะ ขณะนี้ลูกค้าอยู่ในคิวรอเจ้าหน้าที่นะคะ 🙏' }]);
    return { ok: true, alreadyWaiting: true, handover_id: outcome.session.handover_id, deadline_at: outcome.session.handover_deadline };
  }

  var initial = getSetting_('initial_message', getSetting_('handover_initial_message', DEFAULT_SETTINGS.handover_initial_message), 'HANDOVER_SETTINGS');
  sendReplyOrPush_(replyToken, userId, [{ type: 'text', text: initial }]);
  notifyStaffHandover_(userId, displayName || 'ลูกค้า', reason || 'ต้องการติดต่อเจ้าหน้าที่', outcome.handover_id, outcome.deadline_at);
  analyticsIncrement_('handover_request', 1);
  return { ok: true, handover_id: outcome.handover_id, deadline_at: outcome.deadline_at };
}

function notifyStaffHandover_(userId, displayName, reason, handoverId, deadline) {
  if (!truthy_(getSetting_('staff_notify_enabled', 'TRUE'))) return;
  var groups = readSheetObjects_('STAFF_GROUPS').filter(function (g) { return truthy_(g.active) && g.line_group_id; });
  var messages = [{ type: 'text', text: '🔔 ลูกค้าขอติดต่อเจ้าหน้าที่\nลูกค้า: ' + displayName + '\nเหตุผล: ' + String(reason).substring(0, 300) + '\nกรุณาเปิด Live Chat เพื่อรับช่วงสนทนา\nรหัส: ' + handoverId }];
  groups.forEach(function (g) { try { linePush_(g.line_group_id, messages); } catch (err) { logError_('STAFF_NOTIFY', 'Handover notify failed', { group: g.group_name, error: String(err) }); } });
}

function notifyStaffIncomingMessage_(userId, displayName, text) {
  var session = ensureChatSession_(userId);
  if (!session.assigned_agent) return;
  // Human mode messages are visible in Live Chat. Do not push every customer message to staff group by default.
}

function markHandoverAccepted_(handoverId, agent) {
  if (!handoverId) return;
  var rows = readSheetObjects_('HANDOVER_QUEUE');
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i].handover_id) === String(handoverId)) {
      rows[i].handover_status = 'ACCEPTED'; rows[i].assigned_agent = agent; rows[i].callback_status = 'NOT_REQUIRED'; rows[i].updated_at = nowIso_();
      upsertObject_('HANDOVER_QUEUE', 'handover_id', rows[i]); return;
    }
  }
}

function apiListHandoverQueue(options) {
  options = options || {};
  var rows = readSheetObjects_('HANDOVER_QUEUE').reverse();
  if (options.status && options.status !== 'ALL') rows = rows.filter(function (r) { return String(r.handover_status) === String(options.status); });
  return rows.slice(0, clamp_(options.limit, 1, 500, 100));
}

function apiGetHandoverSettings() {
  var out = {};
  Object.keys(DEFAULT_HANDOVER_SETTINGS).forEach(function (k) { out[k] = DEFAULT_HANDOVER_SETTINGS[k]; });
  readSheetObjects_('HANDOVER_SETTINGS').forEach(function (r) { out[String(r.key)] = r.value; });
  return out;
}

function apiSaveHandoverSettings(settings) {
  if (!settings) throw new Error('ข้อมูลตั้งค่าไม่ถูกต้อง');
  var allowed = Object.keys(DEFAULT_HANDOVER_SETTINGS);
  Object.keys(settings).forEach(function (k) { if (allowed.indexOf(k) >= 0) setSetting_(k, settings[k], 'HANDOVER_SETTINGS'); });
  return apiGetHandoverSettings();
}

function processHandoverTimeouts() {
  var runLock = LockService.getScriptLock();
  if (!runLock.tryLock(1000)) return { ok: true, skipped: true, reason: 'another timeout worker is running' };
  try {
  var now = Date.now();
  var rows = readSheetObjects_('HANDOVER_QUEUE');
  var processed = 0;
  rows.forEach(function (row) {
    if (String(row.handover_status) !== 'WAITING' || truthy_(row.timeout_sent)) return;
    var deadline = new Date(row.deadline_at).getTime();
    if (!deadline || deadline > now) return;
    var session = ensureChatSession_(row.user_id);
    if (session.reply_mode === 'HUMAN' || row.handover_status === 'ACCEPTED') {
      row.handover_status = 'ACCEPTED'; row.timeout_sent = 'FALSE'; row.updated_at = nowIso_(); upsertObject_('HANDOVER_QUEUE', 'handover_id', row); return;
    }
    var timeoutMessage = getSetting_('timeout_message', getSetting_('handover_timeout_message', DEFAULT_SETTINGS.handover_timeout_message), 'HANDOVER_SETTINGS');
    try {
      linePush_(row.user_id, [{ type: 'text', text: timeoutMessage }]);
      appendChatMessage_(row.user_id, 'BOT', 'ระบบแจ้งเตือน', 'text', timeoutMessage, {}, 'SENT', '');
      row.timeout_sent = 'TRUE'; row.handover_status = 'TIMEOUT'; row.callback_status = 'PENDING'; row.updated_at = nowIso_();
      session.timeout_sent = 'TRUE';
      var autoResume = truthy_(getSetting_('auto_resume_ai', getSetting_('handover_auto_resume_ai', 'TRUE'), 'HANDOVER_SETTINGS'));
      session.reply_mode = autoResume ? 'AI' : 'PAUSED';
      session.status = 'TIMEOUT'; session.handover_id = ''; session.handover_deadline = ''; session.mode_version = Number(session.mode_version || 0) + 1; session.updated_at = nowIso_();
      upsertObject_('CHAT_SESSIONS', 'user_id', session);
      upsertObject_('HANDOVER_QUEUE', 'handover_id', row);
      processed++;
      notifyStaffTimeout_(row);
      processAutomations_('HANDOVER_TIMEOUT', { user_id: row.user_id, handover: row });
      analyticsIncrement_('handover_timeout', 1);
    } catch (err) {
      row.updated_at = nowIso_();
      logError_('HANDOVER_TIMEOUT', 'Timeout message send failed', { handoverId: row.handover_id, error: String(err) });
    }
  });
  return { ok: true, processed: processed };
  } finally {
    runLock.releaseLock();
  }
}

function notifyStaffTimeout_(handover) {
  var groups = readSheetObjects_('STAFF_GROUPS').filter(function (g) { return truthy_(g.active) && g.line_group_id; });
  groups.forEach(function (g) {
    try { linePush_(g.line_group_id, [{ type: 'text', text: '⚠️ ลูกค้ารอเจ้าหน้าที่ครบเวลาที่กำหนดแล้ว\nUser ID: ' + handover.user_id + '\nกรุณาติดตามลูกค้าใน Live Chat' }]); }
    catch (err) { logError_('STAFF_NOTIFY', 'Timeout staff notification failed', { error: String(err) }); }
  });
}

/* ========================================================================== */
/* ADMINS AND STAFF GROUPS                                                    */
/* ========================================================================== */

function apiListAdmins() { return readSheetObjects_('ADMINS'); }
function apiSaveAdmin(data) {
  if (!data || !data.agent_name) throw new Error('กรุณาระบุชื่อพนักงาน');
  var id = data.agent_id || newId_('AGENT');
  var obj = { agent_id: id, agent_name: String(data.agent_name), display_name: data.display_name || data.agent_name, active: data.active === undefined ? 'TRUE' : String(data.active), created_at: data.created_at || nowIso_(), updated_at: nowIso_() };
  upsertObject_('ADMINS', 'agent_id', obj); return obj;
}
function apiDeleteAdmin(id) { return { ok: deleteByKey_('ADMINS', 'agent_id', id) }; }
function apiListStaffGroups() { return readSheetObjects_('STAFF_GROUPS'); }
function apiSaveStaffGroup(data) {
  if (!data || !data.group_name || !data.line_group_id) throw new Error('กรุณาระบุชื่อกลุ่มและ LINE Group ID');
  var id = data.group_id || newId_('GROUP');
  var obj = { group_id: id, group_name: String(data.group_name), line_group_id: String(data.line_group_id), active: data.active === undefined ? 'TRUE' : String(data.active), created_at: data.created_at || nowIso_(), updated_at: nowIso_() };
  upsertObject_('STAFF_GROUPS', 'group_id', obj); return obj;
}
function apiDeleteStaffGroup(id) { return { ok: deleteByKey_('STAFF_GROUPS', 'group_id', id) }; }
function apiSendTestToStaffGroup(groupId, text) {
  var g = readSheetObjects_('STAFF_GROUPS').filter(function (r) { return String(r.group_id) === String(groupId); })[0];
  if (!g) throw new Error('ไม่พบกลุ่มพนักงาน');
  return linePush_(g.line_group_id, [{ type: 'text', text: text || 'ทดสอบการเชื่อมต่อกลุ่มพนักงานจากระบบก๋วยเตี๋ยวโบราณ by เจ๊อ้น' }]);
}

/* ========================================================================== */
/* GEMINI AI / PLAYGROUND / ORDER EXTRACTION                                  */
/* ========================================================================== */

function getGeminiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('กรุณาตั้งค่า GEMINI_API_KEY ใน Script Properties');
  return key;
}

function getSystemPrompt_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('ai:systemPrompt');
  if (cached) return cached;
  var prompts = apiListPrompts().filter(function (p) { return truthy_(p.active); });
  var prompt = prompts.length ? prompts[0].system_prompt : '';
  var persona = getSetting_('ai_persona', DEFAULT_SETTINGS.ai_persona);
  var full = persona + '\n\n' + prompt + '\n\nข้อบังคับ: ใช้ข้อมูลจากฐานข้อมูลร้านเท่านั้น ห้ามแต่งราคา เมนู เวลาทำการ หรือโปรโมชั่นขึ้นเอง ถ้าไม่พบข้อมูลให้บอกตามตรงและส่งต่อเจ้าหน้าที่เมื่อเหมาะสม ตอบภาษาไทย สุภาพ เป็นกันเอง กระชับ และเข้าใจง่าย';
  cache.put('ai:systemPrompt', full, APP.CACHE_SECONDS);
  return full;
}

function getAiKnowledgeText_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('ai:knowledge');
  if (cached) return cached;
  var knowledge = apiListKnowledge({ activeOnly: true }).slice(0, 100).map(function (r) { return '[' + r.category + '] ' + r.title + ': ' + r.content; }).join('\n');
  var faq = apiListFaq({ activeOnly: true }).slice(0, 100).map(function (r) { return 'ถาม: ' + r.question + '\nตอบ: ' + r.answer; }).join('\n');
  var menu = apiListMenuItems({ availableOnly: true, limit: 300 }).map(function (r) { return 'เมนู: ' + r.name + ' | ราคา: ' + r.price + ' บาท | รายละเอียด: ' + r.description + ' | item_id: ' + r.item_id; }).join('\n');
  var text = 'ข้อมูลความรู้ร้าน:\n' + knowledge + '\n\nFAQ:\n' + faq + '\n\nเมนูที่ขายอยู่:\n' + menu;
  cache.put('ai:knowledge', text.substring(0, 30000), APP.CACHE_SECONDS);
  return text.substring(0, 30000);
}

function generateGeminiReply_(userId, latestText) {
  var props = PropertiesService.getScriptProperties();
  var model = props.getProperty('GEMINI_MODEL') || APP.DEFAULT_GEMINI_MODEL;
  var session = ensureChatSession_(userId);
  var history = apiGetChatHistory(userId, { limit: clamp_(getSetting_('ai_history_limit', '12'), 2, 30, 12) });
  var contents = [];
  history.forEach(function (m) {
    if (m.sender_type !== 'USER' && m.sender_type !== 'AI' && m.sender_type !== 'BOT') return;
    if (!m.text || m.text.charAt(0) === '[') return;
    contents.push({ role: m.sender_type === 'USER' ? 'user' : 'model', parts: [{ text: String(m.text).substring(0, 3000) }] });
  });
  if (!contents.length || contents[contents.length - 1].role !== 'user' || contents[contents.length - 1].parts[0].text !== latestText) {
    contents.push({ role: 'user', parts: [{ text: latestText }] });
  }
  var currentDraft = parseJson_(session.order_draft_json, {});
  var systemText = getSystemPrompt_() + '\n\n' + getAiKnowledgeText_() + '\n\nร่างออเดอร์ปัจจุบัน (ถ้ามี): ' + JSON.stringify(currentDraft) +
    '\n\nให้ตอบกลับเป็น JSON object เท่านั้น มี key: reply (string), intent (chat/menu_request/order/handover/unknown), menu_item_ids (array of string), order (object หรือ null). ' +
    'order มี keys: items(array ของ {item_id,name,quantity,unit_price,options,note}), service_type(dine_in/takeaway/unknown), arrival_time(string), party_count(number), note(string), ready_to_confirm(boolean), missing_fields(array string). ' +
    'ห้ามยืนยันออเดอร์เองจนกว่าลูกค้าจะยืนยันสรุปรายการอย่างชัดเจน ห้ามสร้าง item_id หรือราคาที่ไม่มีในรายการเมนู ให้ใช้ item_id ที่ให้มาเท่านั้น หากลูกค้าถามเมนูหรือขอรูป ให้ใส่ menu_item_ids ที่ตรงกับฐานข้อมูล';
  var payload = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: contents,
    generationConfig: {
      temperature: clamp_(getSetting_('ai_temperature', '0.4'), 0, 1, 0.4),
      maxOutputTokens: clamp_(getSetting_('ai_max_output_tokens', '700'), 128, 4096, 700),
      responseMimeType: 'application/json'
    }
  };
  var url = APP.GEMINI_API + '/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(getGeminiKey_());
  var response = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
  var code = response.getResponseCode();
  var body = parseJson_(response.getContentText(), {});
  if (code < 200 || code >= 300) throw new Error('Gemini API ' + code + ': ' + response.getContentText());
  var raw = body.candidates && body.candidates[0] && body.candidates[0].content && body.candidates[0].content.parts ? body.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('') : '';
  var result = parseJson_(raw, null);
  if (!result) result = { reply: raw || getSetting_('ai_fallback_message', DEFAULT_SETTINGS.ai_fallback_message), intent: 'chat', menu_item_ids: [], order: null };
  result.reply = String(result.reply || 'ขออภัยค่ะ รบกวนพิมพ์คำถามอีกครั้งนะคะ');
  result.menu_item_ids = Array.isArray(result.menu_item_ids) ? result.menu_item_ids : [];
  if (result.order && truthy_(getSetting_('ai_auto_order', 'TRUE'))) saveOrderDraftFromAi_(userId, result.order, latestText);
  return result;
}

function apiTestGemini(prompt) {
  var text = String(prompt || 'สวัสดีครับ ร้านมีเมนูอะไรบ้าง');
  // Playground does not send to LINE and should not persist a chat message.
  return generateGeminiPlayground_(text);
}

function generateGeminiPlayground_(question) {
  var model = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || APP.DEFAULT_GEMINI_MODEL;
  var payload = {
    systemInstruction: { parts: [{ text: getSystemPrompt_() + '\n\n' + getAiKnowledgeText_() }] },
    contents: [{ role: 'user', parts: [{ text: question }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 700 }
  };
  var url = APP.GEMINI_API + '/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(getGeminiKey_());
  var res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
  var data = parseJson_(res.getContentText(), {});
  if (res.getResponseCode() >= 300) throw new Error('Gemini API: ' + res.getContentText());
  var parts = data.candidates && data.candidates[0] && data.candidates[0].content ? data.candidates[0].content.parts : [];
  return { ok: true, model: model, answer: (parts || []).map(function (p) { return p.text || ''; }).join('') };
}

function buildMenuFlexMessage_(itemIds) {
  var allItems = apiListMenuItems({ availableOnly: true, limit: 1000 });
  var selected = allItems.filter(function (item) { return itemIds.indexOf(String(item.item_id)) >= 0 && isHttpsUrl_(item.image_url); }).slice(0, 10);
  if (!selected.length) return null;
  var bubbles = selected.map(function (item) {
    return {
      type: 'bubble', size: 'micro',
      hero: { type: 'image', url: item.image_url, size: 'full', aspectRatio: '20:13', aspectMode: 'cover', action: { type: 'message', label: 'เลือกเมนู', text: 'สนใจ ' + item.name } },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        { type: 'text', text: item.name, weight: 'bold', size: 'md', wrap: true },
        { type: 'text', text: Number(item.price || 0).toLocaleString('th-TH') + ' บาท', color: '#16A34A', weight: 'bold', size: 'sm' },
        { type: 'text', text: String(item.description || '').substring(0, 80), size: 'xs', color: '#777777', wrap: true }
      ] },
      footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', color: '#16A34A', action: { type: 'message', label: 'สั่งเมนูนี้', text: 'สั่ง ' + item.name + ' 1 ที่' } }] }
    };
  });
  return { type: 'flex', altText: 'เมนูแนะนำจากก๋วยเตี๋ยวโบราณ by เจ๊อ้น', contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles } };
}


function getMenuItem_(itemId) {
  var rows = readSheetObjects_('MENU_ITEMS');
  for (var i = 0; i < rows.length; i++) if (String(rows[i].item_id) === String(itemId)) return rows[i];
  return null;
}

function notifyStaffNewFollower_(userId, displayName) {
  if (!truthy_(getSetting_('notify_new_follower', 'FALSE'))) return;
  var groups = readSheetObjects_('STAFF_GROUPS').filter(function (g) { return truthy_(g.active) && g.line_group_id; });
  groups.forEach(function (g) {
    try { linePush_(g.line_group_id, [{ type: 'text', text: '👋 มีเพื่อนใหม่เพิ่ม OA: ' + displayName + '\nUser ID: ' + userId }]); }
    catch (err) { logError_('STAFF_NOTIFY', 'New follower notification failed', { error: String(err) }); }
  });
}

function buildOrderDraftConfirmFlex_(userId) {
  var draft = apiGetOrderDraft(userId);
  if (!draft.items || !draft.items.length || !draft.service_type || !draft.arrival_time || !draft.party_count) return null;
  var rows = draft.items.map(function (it) {
    return { type: 'box', layout: 'baseline', contents: [
      { type: 'text', text: it.name + ' x' + it.quantity, flex: 4, size: 'sm', wrap: true },
      { type: 'text', text: (Number(it.unit_price) * Number(it.quantity)).toLocaleString('th-TH') + ' ฿', flex: 2, size: 'sm', align: 'end' }
    ] };
  });
  rows.push({ type: 'separator', margin: 'md' });
  rows.push({ type: 'text', text: 'รวม ' + Number(draft.subtotal || 0).toLocaleString('th-TH') + ' บาท', weight: 'bold', color: '#16A34A', size: 'lg' });
  rows.push({ type: 'text', text: 'วิธีรับ: ' + (draft.service_type === 'dine_in' ? 'ทานที่ร้าน' : 'กลับบ้าน') + '\nเวลา: ' + draft.arrival_time + '\nจำนวนคน: ' + draft.party_count, size: 'sm', wrap: true });
  rows.push({ type: 'text', text: 'กรุณาตรวจสอบรายการ แล้วกดยืนยันค่ะ', size: 'xs', color: '#777777', wrap: true });
  return {
    type: 'flex', altText: 'ตรวจสอบและยืนยันรายการสั่งอาหาร',
    contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', spacing: 'md', contents: rows },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        { type: 'button', style: 'primary', color: '#16A34A', action: { type: 'postback', label: 'ยืนยันออเดอร์', data: 'action=order_confirm' } },
        { type: 'button', style: 'secondary', action: { type: 'postback', label: 'ยกเลิก', data: 'action=order_cancel' } }
      ] }
    }
  };
}

/* ========================================================================== */
/* ORDER DRAFTS / PRE-ORDER / ORDER MANAGEMENT                                */
/* ========================================================================== */

function saveOrderDraftFromAi_(userId, aiOrder, latestText) {
  var session = ensureChatSession_(userId);
  var old = parseJson_(session.order_draft_json, {});
  var incoming = aiOrder || {};
  var oldItems = Array.isArray(old.items) ? old.items : [];
  var newItems = Array.isArray(incoming.items) ? incoming.items : oldItems;
  // Validate every suggested menu item and use trusted prices from the menu sheet.
  var menu = apiListMenuItems({ limit: 1000 });
  var validItems = [];
  newItems.forEach(function (it) {
    var found = menu.filter(function (m) { return String(m.item_id) === String(it.item_id) || String(m.name) === String(it.name); })[0];
    if (!found || !truthy_(found.available)) return;
    validItems.push({ item_id: found.item_id, name: found.name, quantity: clamp_(it.quantity, 1, 99, 1), unit_price: Number(found.price || 0), options: it.options || '', note: it.note || '' });
  });
  var draft = {
    items: validItems.length ? validItems : oldItems,
    service_type: ['dine_in', 'takeaway'].indexOf(String(incoming.service_type)) >= 0 ? incoming.service_type : (old.service_type || ''),
    arrival_time: incoming.arrival_time || old.arrival_time || '',
    party_count: Number(incoming.party_count || old.party_count || 0),
    note: incoming.note || old.note || '',
    updated_at: nowIso_(),
    last_customer_text: latestText || ''
  };
  draft.subtotal = draft.items.reduce(function (sum, item) { return sum + Number(item.quantity) * Number(item.unit_price); }, 0);
  session.order_draft_json = JSON.stringify(draft); session.updated_at = nowIso_();
  upsertObject_('CHAT_SESSIONS', 'user_id', session);
  return draft;
}

function apiGetOrderDraft(userId) {
  var s = ensureChatSession_(userId);
  return parseJson_(s.order_draft_json, {});
}

function confirmOrderDraft_(userId, replyToken) {
  var draft = apiGetOrderDraft(userId);
  if (!draft.items || !draft.items.length || !draft.service_type || !draft.arrival_time || !draft.party_count) {
    sendReplyOrPush_(replyToken, userId, [{ type: 'text', text: 'ขอข้อมูลเพิ่มเติมอีกนิดนะคะ กรุณาระบุรายการอาหาร วิธีรับอาหาร เวลาที่จะมาถึง และจำนวนคนค่ะ' }]);
    return;
  }
  var order = createOrder_(userId, draft);
  clearOrderDraft_(userId);
  var msg = 'ยืนยันรับออเดอร์เรียบร้อยแล้วค่ะ ❤️\nหมายเลขออเดอร์: ' + order.order_id + '\nยอดรวมประมาณ ' + Number(order.subtotal).toLocaleString('th-TH') + ' บาท\nทางร้านได้รับรายการแล้วนะคะ';
  sendReplyOrPush_(replyToken, userId, [{ type: 'text', text: msg }]);
  notifyStaffNewOrder_(order);
  processAutomations_('ORDER_CREATED', { user_id: userId, order: order });
}

function apiConfirmOrderDraft(userId) {
  var draft = apiGetOrderDraft(userId);
  if (!draft.items || !draft.items.length || !draft.service_type || !draft.arrival_time || !draft.party_count) throw new Error('ข้อมูลออเดอร์ยังไม่ครบ');
  var order = createOrder_(userId, draft); clearOrderDraft_(userId); notifyStaffNewOrder_(order);
  processAutomations_('ORDER_CREATED', { user_id: userId, order: order });
  return order;
}

function clearOrderDraft_(userId) {
  var s = ensureChatSession_(userId); s.order_draft_json = '{}'; s.updated_at = nowIso_(); upsertObject_('CHAT_SESSIONS', 'user_id', s);
}

function createOrder_(userId, draft) {
  var user = getLineUser_(userId) || {};
  var orderId = 'JO-' + Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 90 + 10);
  var order = {
    order_id: orderId, user_id: userId, display_name: user.display_name || '', items_json: JSON.stringify(draft.items), subtotal: Number(draft.subtotal || 0),
    service_type: draft.service_type, arrival_time: draft.arrival_time, party_count: Number(draft.party_count), note: draft.note || '', status: 'NEW', confirmed_at: nowIso_(), created_at: nowIso_(), updated_at: nowIso_()
  };
  appendObject_('ORDERS', order);
  draft.items.forEach(function (it) { appendObject_('ORDER_ITEMS', { order_item_id: newId_('OI'), order_id: orderId, item_id: it.item_id, item_name: it.name, quantity: it.quantity, unit_price: it.unit_price, options: it.options || '', note: it.note || '' }); });
  appendObject_('ORDER_EVENTS', { event_id: newId_('OE'), order_id: orderId, status: 'NEW', agent: 'AI', notes: 'ลูกค้ายืนยันออเดอร์', created_at: nowIso_() });
  analyticsIncrement_('new_order', 1);
  return order;
}

function notifyStaffNewOrder_(order) {
  var groups = readSheetObjects_('STAFF_GROUPS').filter(function (g) { return truthy_(g.active) && g.line_group_id; });
  var items = parseJson_(order.items_json, []);
  var lines = items.map(function (it) { return '• ' + it.name + ' x' + it.quantity + (it.options ? ' (' + it.options + ')' : ''); });
  var text = '🍜 ออเดอร์ใหม่ ' + order.order_id + '\nลูกค้า: ' + (order.display_name || order.user_id) + '\n' + lines.join('\n') + '\nวิธีรับ: ' + (order.service_type === 'dine_in' ? 'ทานที่ร้าน' : 'กลับบ้าน') + '\nเวลามาถึง: ' + order.arrival_time + '\nจำนวนคน: ' + order.party_count + '\nหมายเหตุ: ' + (order.note || '-') + '\nรวม: ' + Number(order.subtotal).toLocaleString('th-TH') + ' บาท';
  var flex = buildOrderFlex_(order);
  groups.forEach(function (g) { try { linePush_(g.line_group_id, [flex || { type: 'text', text: text }]); } catch (err) { logError_('ORDER_NOTIFY', 'Notify staff order failed', { orderId: order.order_id, error: String(err) }); } });
}

function buildOrderFlex_(order) {
  var items = parseJson_(order.items_json, []);
  var contents = [
    { type: 'text', text: 'ออเดอร์ใหม่ ' + order.order_id, weight: 'bold', size: 'lg', color: '#16A34A', wrap: true },
    { type: 'separator', margin: 'md' },
    { type: 'text', text: 'ลูกค้า: ' + (order.display_name || order.user_id), size: 'sm', wrap: true },
    { type: 'text', text: 'วิธีรับ: ' + (order.service_type === 'dine_in' ? 'ทานที่ร้าน' : 'กลับบ้าน'), size: 'sm' },
    { type: 'text', text: 'เวลามาถึง: ' + order.arrival_time + ' | จำนวน ' + order.party_count + ' คน', size: 'sm', wrap: true },
    { type: 'separator', margin: 'md' }
  ];
  items.forEach(function (it) { contents.push({ type: 'box', layout: 'baseline', contents: [{ type: 'text', text: it.name + ' x' + it.quantity, flex: 4, size: 'sm', wrap: true }, { type: 'text', text: (Number(it.unit_price) * Number(it.quantity)).toLocaleString('th-TH') + ' ฿', flex: 2, size: 'sm', align: 'end' }] }); });
  contents.push({ type: 'separator', margin: 'md' });
  contents.push({ type: 'text', text: 'รวม ' + Number(order.subtotal).toLocaleString('th-TH') + ' บาท', weight: 'bold', size: 'lg', color: '#16A34A' });
  contents.push({ type: 'text', text: 'หมายเหตุ: ' + (order.note || '-'), size: 'xs', wrap: true, color: '#777777' });
  return {
    type: 'flex', altText: 'ออเดอร์ใหม่ ' + order.order_id,
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: contents },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        { type: 'button', style: 'primary', color: '#16A34A', action: { type: 'postback', label: 'รับออเดอร์', data: 'action=order_status&order_id=' + encodeURIComponent(order.order_id) + '&status=ACCEPTED' } },
        { type: 'button', style: 'secondary', action: { type: 'postback', label: 'กำลังทำ', data: 'action=order_status&order_id=' + encodeURIComponent(order.order_id) + '&status=PREPARING' } },
        { type: 'button', style: 'secondary', action: { type: 'postback', label: 'อาหารพร้อม', data: 'action=order_status&order_id=' + encodeURIComponent(order.order_id) + '&status=READY' } },
        { type: 'button', style: 'secondary', action: { type: 'postback', label: 'ยกเลิก', data: 'action=order_status&order_id=' + encodeURIComponent(order.order_id) + '&status=CANCELLED' } }
      ] }
    }
  };
}

function apiListOrders(options) {
  options = options || {};
  var rows = readSheetObjects_('ORDERS').reverse();
  if (options.status && options.status !== 'ALL') rows = rows.filter(function (r) { return String(r.status) === String(options.status); });
  if (options.search) {
    var q = String(options.search).toLowerCase(); rows = rows.filter(function (r) { return [r.order_id, r.display_name, r.user_id].join(' ').toLowerCase().indexOf(q) >= 0; });
  }
  rows = rows.slice(0, clamp_(options.limit, 1, 500, 100));
  rows.forEach(function (r) { r.items = parseJson_(r.items_json, []); });
  return rows;
}

function apiUpdateOrderStatus(request) {
  if (!request || !request.order_id || !request.status) throw new Error('ข้อมูลไม่ครบ');
  var rows = readSheetObjects_('ORDERS');
  var order = rows.filter(function (r) { return String(r.order_id) === String(request.order_id); })[0];
  if (!order) throw new Error('ไม่พบออเดอร์');
  order.status = String(request.status); order.updated_at = nowIso_();
  upsertObject_('ORDERS', 'order_id', order);
  appendObject_('ORDER_EVENTS', { event_id: newId_('OE'), order_id: order.order_id, status: order.status, agent: request.agent_name || 'พนักงาน', notes: request.notes || '', created_at: nowIso_() });
  if (request.notify_customer) {
    var statusText = { ACCEPTED: 'ร้านรับออเดอร์แล้วค่ะ', PREPARING: 'ทางร้านกำลังเตรียมอาหารค่ะ', READY: 'อาหารพร้อมแล้วค่ะ', COMPLETED: 'ขอบคุณที่มาใช้บริการค่ะ', CANCELLED: 'ขออภัย ออเดอร์นี้ถูกยกเลิกค่ะ' };
    if (statusText[order.status]) linePush_(order.user_id, [{ type: 'text', text: statusText[order.status] + ' หมายเลข ' + order.order_id }]);
  }
  return order;
}

function apiGetOrderEvents(orderId) { return readSheetObjects_('ORDER_EVENTS').filter(function (e) { return String(e.order_id) === String(orderId); }); }

/* ========================================================================== */
/* KEYWORDS / AUTOMATION                                                      */
/* ========================================================================== */

function apiListKeywordRules() { return readSheetObjects_('KEYWORD_RULES').sort(function (a, b) { return Number(b.priority || 0) - Number(a.priority || 0); }); }
function apiSaveKeywordRule(data) {
  if (!data || !data.keyword) throw new Error('กรุณาระบุ Keyword');
  var id = data.rule_id || newId_('RULE');
  var obj = { rule_id: id, keyword: String(data.keyword), match_type: data.match_type || 'contains', reply_type: data.reply_type || 'text', payload_json: JSON.stringify(data.payload || parseJson_(data.payload_json, {})), priority: Number(data.priority || 0), active: data.active === undefined ? 'TRUE' : String(data.active), created_at: data.created_at || nowIso_(), updated_at: nowIso_() };
  upsertObject_('KEYWORD_RULES', 'rule_id', obj); return obj;
}
function apiDeleteKeywordRule(id) { return { ok: deleteByKey_('KEYWORD_RULES', 'rule_id', id) }; }
function processKeywordRules_(userId, text) {
  var rules = apiListKeywordRules().filter(function (r) { return truthy_(r.active); });
  var q = String(text).toLowerCase();
  for (var i = 0; i < rules.length; i++) {
    var keyword = String(rules[i].keyword).toLowerCase();
    var match = rules[i].match_type === 'exact' ? q.trim() === keyword : (rules[i].match_type === 'starts' ? q.indexOf(keyword) === 0 : q.indexOf(keyword) >= 0);
    if (!match) continue;
    var payload = parseJson_(rules[i].payload_json, {});
    if (rules[i].reply_type === 'flex' && payload.contents) return { handled: true, messages: [{ type: 'flex', altText: payload.altText || 'ข้อความจากร้าน', contents: payload.contents }] };
    if (rules[i].reply_type === 'image' && payload.originalContentUrl && payload.previewImageUrl) return { handled: true, messages: [{ type: 'image', originalContentUrl: payload.originalContentUrl, previewImageUrl: payload.previewImageUrl }] };
    if (payload.text) return { handled: true, messages: [{ type: 'text', text: String(payload.text) }] };
  }
  return null;
}

function apiListAutomations() { return readSheetObjects_('AUTOMATIONS').reverse(); }
function apiSaveAutomation(data) {
  if (!data || !data.name) throw new Error('กรุณาระบุชื่อ Automation');
  var allowedTriggers = ['FOLLOW', 'KEYWORD', 'ORDER_CREATED', 'HANDOVER_TIMEOUT'];
  var triggerType = String(data.trigger_type || 'KEYWORD').toUpperCase();
  if (allowedTriggers.indexOf(triggerType) < 0) throw new Error('Trigger ของ Automation ไม่ถูกต้อง');
  var allowedActions = ['REPLY_TEXT', 'SEND_FLEX', 'SEND_IMAGE', 'ADD_TAG', 'HANDOVER', 'NOTIFY_STAFF'];
  var actionType = String(data.action_type || 'REPLY_TEXT').toUpperCase();
  if (allowedActions.indexOf(actionType) < 0) throw new Error('Action ของ Automation ไม่ถูกต้อง');
  var id = data.automation_id || newId_('AUTO');
  var obj = { automation_id: id, name: String(data.name), trigger_type: triggerType, trigger_value: data.trigger_value || '', action_type: actionType, payload_json: JSON.stringify(data.payload || parseJson_(data.payload_json, {})), active: data.active === undefined ? 'TRUE' : String(data.active), created_at: data.created_at || nowIso_(), updated_at: nowIso_() };
  upsertObject_('AUTOMATIONS', 'automation_id', obj); return obj;
}
function apiDeleteAutomation(id) { return { ok: deleteByKey_('AUTOMATIONS', 'automation_id', id) }; }

/**
 * Executes configured automations for a small set of deterministic triggers.
 * Supported actions: REPLY_TEXT, SEND_FLEX, SEND_IMAGE, ADD_TAG, HANDOVER, NOTIFY_STAFF.
 * Keyword trigger_value accepts comma-separated terms; payload.match_type may be exact/starts/contains.
 */
function processAutomations_(triggerType, context) {
  context = context || {};
  var trigger = String(triggerType || '').toUpperCase();
  var rows = readSheetObjects_('AUTOMATIONS').filter(function (r) {
    return truthy_(r.active) && String(r.trigger_type || '').toUpperCase() === trigger;
  });
  var matched = [];
  var customerMessages = [];
  rows.forEach(function (row) {
    var payload = parseJson_(row.payload_json, {});
    if (trigger === 'KEYWORD') {
      var text = String(context.text || '').toLowerCase().trim();
      var terms = String(row.trigger_value || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
      var mode = String(payload.match_type || 'contains').toLowerCase();
      var ok = terms.some(function (term) {
        if (mode === 'exact') return text === term;
        if (mode === 'starts') return text.indexOf(term) === 0;
        return text.indexOf(term) >= 0;
      });
      if (!ok) return;
    }
    try {
      var action = String(row.action_type || '').toUpperCase();
      if (action === 'REPLY_TEXT') {
        var reply = renderFlowText_(payload.text || '', { customer_name: context.display_name || '', shop_name: getSetting_('shop_name', APP.NAME) });
        if (reply) customerMessages.push({ type: 'text', text: reply.substring(0, 5000) });
      } else if (action === 'SEND_FLEX') {
        var template = readSheetObjects_('FLEX_TEMPLATES').filter(function (t) { return String(t.template_id) === String(payload.template_id); })[0];
        if (!template) throw new Error('ไม่พบ Flex Template');
        customerMessages.push({ type: 'flex', altText: template.alt_text || template.name, contents: parseJson_(template.contents_json, {}) });
      } else if (action === 'SEND_IMAGE') {
        if (!isHttpsUrl_(payload.originalContentUrl) || !isHttpsUrl_(payload.previewImageUrl)) throw new Error('Image URL ต้องเป็น HTTPS');
        customerMessages.push({ type: 'image', originalContentUrl: payload.originalContentUrl, previewImageUrl: payload.previewImageUrl });
      } else if (action === 'ADD_TAG') {
        var user = getLineUser_(context.user_id);
        if (user && payload.tag) {
          var tags = String(user.tags || '').split(',').filter(Boolean);
          if (tags.indexOf(String(payload.tag)) < 0) tags.push(String(payload.tag));
          user.tags = tags.join(','); user.updated_at = nowIso_(); upsertObject_('LINE_USERS', 'user_id', user);
        }
      } else if (action === 'HANDOVER') {
        createHandoverRequest_(context.user_id, context.reply_token || null, payload.reason || row.name, context.display_name || 'ลูกค้า');
      } else if (action === 'NOTIFY_STAFF') {
        readSheetObjects_('STAFF_GROUPS').filter(function (g) { return truthy_(g.active) && g.line_group_id; }).forEach(function (g) {
          linePush_(g.line_group_id, [{ type: 'text', text: String(payload.text || row.name || 'มีเหตุการณ์จาก Automation').substring(0, 5000) }]);
        });
      }
      matched.push(row.automation_id);
      appendObject_('SYSTEM_LOGS', { log_id: newId_('LOG'), level: 'INFO', category: 'AUTOMATION', message: 'Automation executed: ' + row.name, detail_json: JSON.stringify({ automation_id: row.automation_id, trigger: trigger, user_id: context.user_id || '', action: action }), created_at: nowIso_() });
    } catch (err) {
      logError_('AUTOMATION', 'Automation execution failed', { automation_id: row.automation_id, error: String(err) });
    }
  });
  if (customerMessages.length && context.user_id) {
    var batches = [];
    for (var i = 0; i < customerMessages.length; i += APP.MAX_LINE_MESSAGES) batches.push(customerMessages.slice(i, i + APP.MAX_LINE_MESSAGES));
    if (context.reply_token && batches.length) {
      sendReplyOrPush_(context.reply_token, context.user_id, batches.shift());
    }
    batches.forEach(function (batch) { linePush_(context.user_id, batch); });
    customerMessages.forEach(function (m) { appendChatMessage_(context.user_id, 'BOT', 'Automation', m.type, m.text || '[Automation Message]', m, 'SENT', ''); });
  }
  return matched.length > 0 && (trigger === 'KEYWORD' || customerMessages.length > 0);
}

/* ========================================================================== */
/* CONVERSATION FLOW BUILDER AND RUNTIME                                      */
/* ========================================================================== */

function apiListConversationFlows() {
  return readSheetObjects_('CONVERSATION_FLOWS').reverse().map(function (r) {
    r.nodes = parseJson_(r.nodes_json, []);
    return r;
  });
}

function apiSaveConversationFlow(data) {
  if (!data || !data.name || !Array.isArray(data.nodes)) throw new Error('กรุณาระบุชื่อ Flow และรายการ Nodes');
  if (data.nodes.length > 100) throw new Error('Flow หนึ่งรายการรองรับไม่เกิน 100 Nodes');
  data.nodes.forEach(function (node, index) {
    var type = String(node.type || '').toLowerCase();
    if (['text', 'image', 'flex', 'question', 'tag', 'handover', 'end'].indexOf(type) < 0) {
      throw new Error('Node ลำดับ ' + (index + 1) + ' มี type ไม่ถูกต้อง');
    }
    if ((type === 'text' || type === 'question') && !node.text) throw new Error('Node ลำดับ ' + (index + 1) + ' ต้องมีข้อความ');
    if (type === 'image' && (!isHttpsUrl_(node.originalContentUrl || node.original_content_url) || !isHttpsUrl_(node.previewImageUrl || node.preview_image_url))) {
      throw new Error('Node รูปภาพลำดับ ' + (index + 1) + ' ต้องใช้ URL HTTPS');
    }
    if (type === 'flex') {
      var contents = node.contents;
      if (!contents && node.template_id) {
        var template = readSheetObjects_('FLEX_TEMPLATES').filter(function (t) { return String(t.template_id) === String(node.template_id); })[0];
        if (!template) throw new Error('ไม่พบ Flex Template ใน Node ลำดับ ' + (index + 1));
        contents = parseJson_(template.contents_json, {});
      }
      validateFlexContents_(contents);
    }
    if (type === 'tag' && !node.tag) throw new Error('Node Tag ลำดับ ' + (index + 1) + ' ต้องระบุ Tag');
  });
  var id = data.flow_id || newId_('FLOW');
  var obj = {
    flow_id: id, name: String(data.name), description: data.description || '',
    trigger_type: String(data.trigger_type || 'KEYWORD').toUpperCase(), trigger_value: data.trigger_value || '',
    nodes_json: JSON.stringify(data.nodes), active: data.active === undefined ? 'TRUE' : String(data.active),
    created_at: data.created_at || nowIso_(), updated_at: nowIso_()
  };
  upsertObject_('CONVERSATION_FLOWS', 'flow_id', obj);
  return obj;
}

function apiDeleteConversationFlow(flowId) {
  return { ok: deleteByKey_('CONVERSATION_FLOWS', 'flow_id', flowId) };
}

function apiListFlowSessions(options) {
  options = options || {};
  var rows = readSheetObjects_('FLOW_SESSIONS').reverse();
  if (options.status && options.status !== 'ALL') rows = rows.filter(function (r) { return String(r.status) === String(options.status); });
  if (options.user_id) rows = rows.filter(function (r) { return String(r.user_id) === String(options.user_id); });
  return rows.slice(0, clamp_(options.limit, 1, 500, 100));
}

function apiCancelFlowSession(userId) {
  if (!userId) throw new Error('กรุณาระบุ LINE User ID');
  var state = readSheetObjects_('FLOW_SESSIONS').filter(function (r) { return String(r.user_id) === String(userId); })[0];
  if (!state) return { ok: false, message: 'ไม่พบ Flow Session' };
  state.status = 'CANCELLED'; state.updated_at = nowIso_();
  upsertObject_('FLOW_SESSIONS', 'user_id', state);
  return { ok: true };
}

function renderFlowText_(text, answers) {
  var result = String(text || '');
  Object.keys(answers || {}).forEach(function (key) {
    result = result.replace(new RegExp('\\{\\{' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\}\\}', 'g'), String(answers[key]));
  });
  return result;
}

/**
 * Runs the user's current flow step, or starts a flow on a matching trigger.
 * Node types: text, image, flex, question, tag, handover, end.
 */
function processConversationFlows_(userId, userText, replyToken, eventType) {
  var states = readSheetObjects_('FLOW_SESSIONS');
  var state = states.filter(function (r) { return String(r.user_id) === String(userId) && (r.status === 'WAITING_INPUT' || r.status === 'RUNNING'); })[0];
  var flow = null;
  var answers = {};
  var nodes = [];

  if (state) {
    flow = readSheetObjects_('CONVERSATION_FLOWS').filter(function (r) { return String(r.flow_id) === String(state.flow_id) && truthy_(r.active); })[0];
    if (!flow) {
      state.status = 'CANCELLED'; state.updated_at = nowIso_(); upsertObject_('FLOW_SESSIONS', 'user_id', state);
      return false;
    }
    nodes = parseJson_(flow.nodes_json, []);
    answers = parseJson_(state.answers_json, {});
    var waitingNode = nodes[Number(state.node_index || 0)];
    if (state.status === 'WAITING_INPUT' && waitingNode && waitingNode.type === 'question') {
      answers[waitingNode.save_as || 'answer'] = String(userText || '').substring(0, 2000);
      state.node_index = Number(state.node_index || 0) + 1;
      state.answers_json = JSON.stringify(answers);
      state.status = 'RUNNING';
    }
  } else {
    var trigger = String(eventType || 'MESSAGE').toUpperCase();
    var candidateFlows = readSheetObjects_('CONVERSATION_FLOWS').filter(function (r) {
      return truthy_(r.active) && String(r.trigger_type || 'KEYWORD').toUpperCase() === (trigger === 'FOLLOW' ? 'FOLLOW' : 'KEYWORD');
    });
    var query = String(userText || '').toLowerCase();
    flow = candidateFlows.filter(function (r) {
      if (trigger === 'FOLLOW') return true;
      var values = String(r.trigger_value || '').split(',').map(function (v) { return v.trim().toLowerCase(); }).filter(Boolean);
      return values.some(function (v) { return query.indexOf(v) >= 0; });
    })[0];
    if (!flow) return false;
    nodes = parseJson_(flow.nodes_json, []);
    state = { user_id: userId, flow_id: flow.flow_id, node_index: 0, answers_json: '{}', status: 'RUNNING', started_at: nowIso_(), updated_at: nowIso_() };
  }

  var messages = [];
  var handoverReason = '';
  var completed = false;
  while (Number(state.node_index || 0) < nodes.length) {
    var nodeIndex = Number(state.node_index || 0);
    var node = nodes[nodeIndex] || {};
    var type = String(node.type || '').toLowerCase();
    state.node_index = nodeIndex + 1;
    if (type === 'text') {
      messages.push({ type: 'text', text: renderFlowText_(node.text, answers).substring(0, 5000) });
    } else if (type === 'image') {
      messages.push({ type: 'image', originalContentUrl: node.originalContentUrl || node.original_content_url, previewImageUrl: node.previewImageUrl || node.preview_image_url });
    } else if (type === 'flex') {
      var flexContents = node.contents;
      var flexAltText = node.altText || 'ข้อความจากร้าน';
      if (!flexContents && node.template_id) {
        var flexTemplate = readSheetObjects_('FLEX_TEMPLATES').filter(function (t) { return String(t.template_id) === String(node.template_id); })[0];
        if (flexTemplate) { flexContents = parseJson_(flexTemplate.contents_json, {}); flexAltText = flexTemplate.alt_text || flexTemplate.name; }
      }
      if (flexContents) messages.push({ type: 'flex', altText: flexAltText, contents: flexContents });
    } else if (type === 'question') {
      messages.push({ type: 'text', text: renderFlowText_(node.text, answers).substring(0, 5000) });
      // Keep the pointer on the question node until the next customer message is stored as its answer.
      state.node_index = nodeIndex;
      state.status = 'WAITING_INPUT';
      break;
    } else if (type === 'tag') {
      var member = getLineUser_(userId);
      if (member) {
        var tags = String(member.tags || '').split(',').filter(Boolean);
        if (tags.indexOf(String(node.tag)) < 0) tags.push(String(node.tag));
        member.tags = tags.join(','); member.updated_at = nowIso_();
        upsertObject_('LINE_USERS', 'user_id', member);
      }
    } else if (type === 'handover') {
      handoverReason = renderFlowText_(node.reason || 'ส่งต่อให้เจ้าหน้าที่ตาม Flow', answers);
      completed = true;
      break;
    } else if (type === 'end') {
      completed = true;
      break;
    }
  }

  if (Number(state.node_index || 0) >= nodes.length) completed = true;
  state.answers_json = JSON.stringify(answers);
  state.status = completed ? 'COMPLETED' : (state.status === 'WAITING_INPUT' ? 'WAITING_INPUT' : 'RUNNING');
  state.updated_at = nowIso_();
  upsertObject_('FLOW_SESSIONS', 'user_id', state);

  if (messages.length) {
    if (replyToken) {
      lineReply_(replyToken, messages.slice(0, APP.MAX_LINE_MESSAGES));
      for (var i = APP.MAX_LINE_MESSAGES; i < messages.length; i += APP.MAX_LINE_MESSAGES) linePush_(userId, messages.slice(i, i + APP.MAX_LINE_MESSAGES));
    } else {
      for (var j = 0; j < messages.length; j += APP.MAX_LINE_MESSAGES) linePush_(userId, messages.slice(j, j + APP.MAX_LINE_MESSAGES));
    }
    messages.forEach(function (m) { appendChatMessage_(userId, 'BOT', 'Conversation Flow', m.type, m.text || '[Flow Message]', m, 'SENT', ''); });
  }
  if (handoverReason) createHandoverRequest_(userId, null, handoverReason, (getLineUser_(userId) || {}).display_name || 'ลูกค้า');
  appendObject_('FLOW_LOGS', { flow_log_id: newId_('FLOWLOG'), user_id: userId, flow_id: flow.flow_id, event: eventType || 'MESSAGE', detail_json: JSON.stringify({ node_index: state.node_index, status: state.status }), created_at: nowIso_() });
  return true;
}

/* ========================================================================== */
/* RICH MENU MANAGEMENT                                                       */
/* ========================================================================== */

function apiListRichMenus() { return readSheetObjects_('RICH_MENU').map(function (r) { r.config = parseJson_(r.richmenu_json, {}); return r; }); }
function apiSaveRichMenuDraft(data) {
  if (!data || !data.name || !data.richmenu) throw new Error('กรุณาระบุชื่อและ Rich Menu JSON');
  var id = data.richmenu_id || newId_('RM');
  var obj = { richmenu_id: id, line_richmenu_id: data.line_richmenu_id || '', name: data.name, richmenu_json: JSON.stringify(data.richmenu), image_url: data.image_url || '', is_default: data.is_default ? 'TRUE' : 'FALSE', active: data.active === undefined ? 'TRUE' : String(data.active), created_at: data.created_at || nowIso_(), updated_at: nowIso_() };
  upsertObject_('RICH_MENU', 'richmenu_id', obj); return obj;
}
function apiCreateLineRichMenu(recordId) {
  var record = readSheetObjects_('RICH_MENU').filter(function (r) { return String(r.richmenu_id) === String(recordId); })[0];
  if (!record) throw new Error('ไม่พบ Rich Menu');
  var config = parseJson_(record.richmenu_json, {});
  var result = lineRequest_('post', '/v2/bot/richmenu', config);
  record.line_richmenu_id = result.richMenuId; record.active = 'TRUE'; record.updated_at = nowIso_();
  upsertObject_('RICH_MENU', 'richmenu_id', record);
  if (record.image_url) apiUploadRichMenuImage(result.richMenuId, record.image_url);
  if (truthy_(record.is_default)) lineRequest_('post', '/v2/bot/user/all/richmenu/' + encodeURIComponent(result.richMenuId));
  return result;
}
function apiLinkRichMenuToUser(request) {
  if (!request || !request.user_id || !request.richmenu_id) throw new Error('กรุณาระบุสมาชิกและ Rich Menu');
  var record = readSheetObjects_('RICH_MENU').filter(function (r) { return String(r.richmenu_id) === String(request.richmenu_id) || String(r.line_richmenu_id) === String(request.richmenu_id); })[0];
  var lineId = record ? record.line_richmenu_id : request.richmenu_id;
  if (!lineId) throw new Error('Rich Menu ยังไม่ได้สร้างบน LINE');
  lineRequest_('post', '/v2/bot/user/' + encodeURIComponent(request.user_id) + '/richmenu/' + encodeURIComponent(lineId));
  return { ok: true, user_id: request.user_id, line_richmenu_id: lineId };
}

function apiUnlinkRichMenuFromUser(userId) {
  if (!userId) throw new Error('กรุณาระบุ LINE User ID');
  lineRequest_('delete', '/v2/bot/user/' + encodeURIComponent(userId) + '/richmenu');
  return { ok: true, user_id: userId };
}

function apiUploadRichMenuImage(lineRichMenuId, imageUrl) {
  if (!isHttpsUrl_(imageUrl)) throw new Error('รูป Rich Menu ต้องเป็น HTTPS URL');
  var img = UrlFetchApp.fetch(imageUrl, { muteHttpExceptions: true });
  if (img.getResponseCode() >= 300) throw new Error('ดาวน์โหลดรูป Rich Menu ไม่สำเร็จ');
  var blob = img.getBlob();
  var type = blob.getContentType() || 'image/png';
  if (['image/jpeg', 'image/png'].indexOf(type) < 0) throw new Error('LINE Rich Menu รองรับไฟล์ JPEG หรือ PNG');
  return lineRequest_('post', '/v2/bot/richmenu/' + encodeURIComponent(lineRichMenuId) + '/content', blob, type, true);
}
function apiDeleteRichMenu(id) {
  var record = readSheetObjects_('RICH_MENU').filter(function (r) { return String(r.richmenu_id) === String(id) || String(r.line_richmenu_id) === String(id); })[0];
  var lineId = record ? record.line_richmenu_id : id;
  if (lineId) lineRequest_('delete', '/v2/bot/richmenu/' + encodeURIComponent(lineId));
  if (record) deleteByKey_('RICH_MENU', 'richmenu_id', record.richmenu_id);
  return { ok: true };
}

/* ========================================================================== */
/* BROADCAST RECORDS                                                          */
/* ========================================================================== */

function apiListBroadcasts() { return readSheetObjects_('BROADCAST').reverse(); }
function apiSaveBroadcastDraft(data) {
  if (!data || !data.name || !data.message) throw new Error('กรุณาระบุชื่อแคมเปญและข้อความ');
  var id = data.broadcast_id || newId_('BC');
  var obj = { broadcast_id: id, name: String(data.name), target_type: data.target_type || 'SELECTED_USERS', target_json: JSON.stringify(data.target || {}), message_json: JSON.stringify(data.message), status: 'DRAFT', scheduled_at: data.scheduled_at || '', sent_at: '', created_at: data.created_at || nowIso_(), updated_at: nowIso_() };
  upsertObject_('BROADCAST', 'broadcast_id', obj); return obj;
}

function apiScheduleBroadcast(request) {
  if (!request || !request.broadcast_id || !request.scheduled_at) throw new Error('กรุณาระบุ Broadcast และเวลาที่ต้องการส่ง');
  var row = readSheetObjects_('BROADCAST').filter(function (r) { return String(r.broadcast_id) === String(request.broadcast_id); })[0];
  if (!row) throw new Error('ไม่พบ Broadcast');
  var scheduledAt = new Date(request.scheduled_at);
  if (isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) throw new Error('เวลาส่งต้องเป็นเวลาในอนาคต');
  row.status = 'SCHEDULED'; row.scheduled_at = scheduledAt.toISOString();
  upsertObject_('BROADCAST', 'broadcast_id', row);
  return { ok: true, broadcast: row };
}

function apiSendBroadcastNow(broadcastId) {
  return withScriptLock_(function () {
    var row = readSheetObjects_('BROADCAST').filter(function (r) { return String(r.broadcast_id) === String(broadcastId); })[0];
    if (!row) throw new Error('ไม่พบ Broadcast');
    if (row.status === 'SENT' || row.status === 'SENDING') throw new Error('แคมเปญนี้ถูกส่งไปแล้วหรือกำลังส่ง');
    return sendBroadcastRecord_(row);
  });
}

function sendBroadcastRecord_(row) {
  var target = parseJson_(row.target_json, {});
  var ids = resolveBroadcastUserIds_(target, row.target_type);
  var message = parseJson_(row.message_json, null);
  if (!ids.length || !message) throw new Error('ไม่พบสมาชิกเป้าหมายหรือข้อความ');
  var messages = Array.isArray(message) ? message.slice(0, APP.MAX_LINE_MESSAGES) : [message];
  var sent = 0;
  for (var i = 0; i < ids.length; i += APP.MAX_MULTICAST_USERS) {
    lineMulticast_(ids.slice(i, i + APP.MAX_MULTICAST_USERS), messages);
    sent += Math.min(APP.MAX_MULTICAST_USERS, ids.length - i);
  }
  row.status = 'SENT'; row.sent_at = nowIso_(); row.scheduled_at = ''; row.updated_at = nowIso_();
  upsertObject_('BROADCAST', 'broadcast_id', row);
  return { ok: true, sent: sent, broadcast_id: row.broadcast_id };
}

function apiCancelBroadcast(broadcastId) {
  var row = readSheetObjects_('BROADCAST').filter(function (r) { return String(r.broadcast_id) === String(broadcastId); })[0];
  if (!row) return { ok: false, message: 'ไม่พบ Broadcast' };
  if (row.status === 'SENT') throw new Error('แคมเปญที่ส่งแล้วไม่สามารถยกเลิกได้');
  row.status = 'CANCELLED'; row.scheduled_at = '';
  upsertObject_('BROADCAST', 'broadcast_id', row);
  return { ok: true };
}

function resolveBroadcastUserIds_(target, targetType) {
  target = target || {};
  targetType = String(targetType || target.type || 'SELECTED_USERS').toUpperCase();
  if (targetType === 'SELECTED_USERS') {
    if (!Array.isArray(target.user_ids) || !target.user_ids.length) return [];
    return target.user_ids.map(String).filter(Boolean);
  }
  var users = readSheetObjects_('LINE_USERS').filter(function (u) { return u.friend_status !== 'UNFOLLOW'; });
  if (targetType === 'TAG' || targetType === 'TAGGED_USERS') {
    if (!target.tag) return [];
    users = users.filter(function (u) { return String(u.tags || '').split(',').indexOf(String(target.tag)) >= 0; });
  } else if (targetType !== 'ALL_FRIENDS') {
    return [];
  }
  if (target.exclude_user_ids && target.exclude_user_ids.length) {
    var excluded = {};
    target.exclude_user_ids.forEach(function (id) { excluded[String(id)] = true; });
    users = users.filter(function (u) { return !excluded[String(u.user_id)]; });
  }
  return users.map(function (u) { return String(u.user_id); }).filter(Boolean);
}

/* ========================================================================== */
/* ANALYTICS / LOGS                                                           */
/* ========================================================================== */

function analyticsIncrement_(metric, amount) {
  var date = Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd');
  var sh = getSheet_('ANALYTICS');
  var data = sh.getDataRange().getValues();
  var headers = data[0].map(String);
  var dateCol = headers.indexOf('date');
  var metricCol = headers.indexOf('metric');
  var valueCol = headers.indexOf('value');
  var updatedCol = headers.indexOf('updated_at');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][dateCol]) === date && String(data[i][metricCol]) === String(metric)) {
      sh.getRange(i + 1, valueCol + 1).setValue(Number(data[i][valueCol] || 0) + Number(amount || 1));
      sh.getRange(i + 1, updatedCol + 1).setValue(nowIso_());
      return;
    }
  }
  appendObject_('ANALYTICS', { date: date, metric: metric, value: Number(amount || 1), detail: '', updated_at: nowIso_() });
}

function apiGetAnalytics(options) {
  options = options || {};
  var rows = readSheetObjects_('ANALYTICS');
  if (options.from) rows = rows.filter(function (r) { return String(r.date) >= String(options.from); });
  if (options.to) rows = rows.filter(function (r) { return String(r.date) <= String(options.to); });
  return rows;
}

function apiListSystemLogs(options) {
  options = options || {};
  var rows = readSheetObjects_('SYSTEM_LOGS').reverse();
  if (options.level) rows = rows.filter(function (r) { return String(r.level) === String(options.level); });
  if (options.category) rows = rows.filter(function (r) { return String(r.category) === String(options.category); });
  return rows.slice(0, clamp_(options.limit, 1, 1000, 200)).map(function (r) { r.detail = parseJson_(r.detail_json, {}); return r; });
}

function logInfo_(category, message, detail) { writeLog_('INFO', category, message, detail); }
function logWarning_(category, message, detail) { writeLog_('WARN', category, message, detail); }
function logError_(category, message, detail) { writeLog_('ERROR', category, message, detail); }
function writeLog_(level, category, message, detail) {
  try { appendObject_('SYSTEM_LOGS', { log_id: newId_('LOG'), level: level, category: category, message: message, detail_json: JSON.stringify(detail || {}), created_at: nowIso_() }); }
  catch (err) { console.error(level + ' ' + category + ' ' + message + ' ' + String(err)); }
}

/* ========================================================================== */
/* TRIGGERS / SCHEDULED MAINTENANCE                                           */
/* ========================================================================== */

function installSystemTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var exists = triggers.some(function (t) { return t.getHandlerFunction() === 'processHandoverTimeouts'; });
  if (!exists) ScriptApp.newTrigger('processHandoverTimeouts').timeBased().everyMinutes(1).create();
  var queueExists = triggers.some(function (t) { return t.getHandlerFunction() === 'processScheduledBroadcasts'; });
  if (!queueExists) ScriptApp.newTrigger('processScheduledBroadcasts').timeBased().everyMinutes(5).create();
  return { ok: true, triggers: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }) };
}

function removeSystemTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  return { ok: true };
}

function processScheduledBroadcasts() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: true, skipped: true };
  try {
    var rows = readSheetObjects_('BROADCAST');
    var now = Date.now();
    var sent = 0;
    rows.forEach(function (row) {
      if (row.status !== 'SCHEDULED' || !row.scheduled_at || new Date(row.scheduled_at).getTime() > now) return;
      try {
        row.status = 'SENDING'; row.updated_at = nowIso_(); upsertObject_('BROADCAST', 'broadcast_id', row);
        sendBroadcastRecord_(row);
        sent++;
      } catch (err) {
        row.status = 'FAILED'; row.updated_at = nowIso_(); upsertObject_('BROADCAST', 'broadcast_id', row);
        logError_('BROADCAST', 'Scheduled broadcast failed', { id: row.broadcast_id, error: String(err) });
      }
    });
    return { ok: true, sent: sent };
  } finally {
    lock.releaseLock();
  }
}

/* ========================================================================== */
/* LINE QUOTA / BOT INFO                                                      */
/* ========================================================================== */

function apiGetLineBotInfo() { return lineRequest_('get', '/v2/bot/info'); }
function apiGetLineMessageQuota() { return lineRequest_('get', '/v2/bot/message/quota'); }
function apiGetLineMessageQuotaConsumption() { return lineRequest_('get', '/v2/bot/message/quota/consumption'); }

/* ========================================================================== */
/* SMALL UTILITIES / TESTS                                                    */
/* ========================================================================== */

function apiTestLineConnection() {
  var info = apiGetLineBotInfo();
  return { ok: true, bot: info };
}

function apiTestImgBbConnection() {
  var key = PropertiesService.getScriptProperties().getProperty('IMGBB_API_KEY');
  if (!key) throw new Error('กรุณาตั้งค่า IMGBB_API_KEY');
  // ImgBB has no lightweight authenticated ping endpoint; report that a key is configured.
  return { ok: true, keyConfigured: true, note: 'ทดสอบการอัปโหลดจริงได้จากเมนูจัดการรูปภาพ' };
}

function apiGetPublicAppInfo() {
  return { name: APP.NAME, version: APP.VERSION, shopName: getSetting_('shop_name', APP.NAME), phone: getSetting_('shop_phone', '') };
}

function apiGetSpreadsheetUrl() { return getSpreadsheet_().getUrl(); }

/** Run manually to check that required tabs and headers still exist. */
function validateSystemSetup() {
  var missing = [];
  var ss = getSpreadsheet_();
  Object.keys(SHEET_SCHEMAS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { missing.push(name); return; }
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    SHEET_SCHEMAS[name].forEach(function (h) { if (headers.indexOf(h) < 0) missing.push(name + '.' + h); });
  });
  if (missing.length) throw new Error('Schema ไม่ครบ: ' + missing.join(', '));
  return { ok: true, sheetCount: Object.keys(SHEET_SCHEMAS).length, message: 'Schema ครบถ้วน' };
}
