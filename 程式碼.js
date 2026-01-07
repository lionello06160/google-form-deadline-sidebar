/** =========================
 *  Code.gs  (Form-bound GAS)
 *  功能：
 *  - 自訂選單：期限 Deadline
 *  - Sidebar：設定/取消截止時間、立即開/關回應、顯示狀態
 *  - Time trigger：到期自動關閉回應
 *  - 副本表單：自動補 trigger（如果有期限但 trigger 不見）
 * ========================= */

const PROP_KEY = "DEADLINE_ISO";      // DocumentProperties key
const TRIGGER_FN = "deadlineCloseJob"; // Trigger handler function name

function onOpen(e) {
  FormApp.getUi()
    .createMenu("期限 Deadline")
    .addItem("設定/管理…", "openDeadlineSidebar")
    .addSeparator()
    .addItem("立即關閉回應", "closeNow")
    .addItem("立即開啟回應", "openNow")
    .addSeparator()
    .addItem("顯示目前狀態（彈窗）", "showStatusDialog")
    .addToUi();

  // 重要：如果這份表單是從別人/自己副本來的，有 deadline 但 trigger 沒了，補上
  ensureDeadlineTrigger_();
}

function openDeadlineSidebar() {
  const html = HtmlService.createHtmlOutputFromFile("Sidebar")
    .setTitle("期限管理");
  FormApp.getUi().showSidebar(html);
}

/** 給前端 Sidebar 取得狀態 */
function getStatus() {
  const form = FormApp.getActiveForm();
  const iso = PropertiesService.getDocumentProperties().getProperty(PROP_KEY);
  const deadline = iso ? new Date(iso) : null;
  const now = new Date();

  return {
    accepting: form.isAcceptingResponses(),
    deadlineIso: iso || "",
    deadlineText: deadline ? formatDateForDisplay_(deadline) : "",
    isExpired: deadline && now > deadline,
    scriptTimeZone: Session.getScriptTimeZone(),
    nowText: formatDateForDisplay_(now),
  };
}

/**
 * 設定/更新截止時間
 * @param {string} isoString - ISO 8601 datetime string (UTC ok)
 */
function setDeadline(isoString) {
  if (!isoString) throw new Error("Missing deadline datetime.");

  const deadline = new Date(isoString);
  if (isNaN(deadline.getTime())) throw new Error("Invalid datetime format.");

  // 存起來
  PropertiesService.getDocumentProperties().setProperty(PROP_KEY, deadline.toISOString());

  // 自動開啟表單
  FormApp.getActiveForm().setAcceptingResponses(true);

  // 先刪掉舊的 trigger，再建新的
  deleteDeadlineTriggers_();
  ScriptApp.newTrigger(TRIGGER_FN)
    .timeBased()
    .at(deadline)
    .create();

  return getStatus();
}

/** 取消截止（清掉 property + trigger） */
function cancelDeadline() {
  PropertiesService.getDocumentProperties().deleteProperty(PROP_KEY);
  deleteDeadlineTriggers_();
  return getStatus();
}

/** 立即關閉回應 */
function closeNow() {
  FormApp.getActiveForm().setAcceptingResponses(false);
  return getStatus();
}

/** 立即開啟回應 */
function openNow() {
  FormApp.getActiveForm().setAcceptingResponses(true);
  return getStatus();
}

/** 額外：用小彈窗顯示狀態 */
function showStatusDialog() {
  const s = getStatus();
  const deadlineLine = s.deadlineIso ? `⏰ 截止：${s.deadlineText}` : "⏰ 未設定期限";
  const acceptingLine = s.accepting ? "✅ 接受回應中" : "⛔ 已關閉回應";
  const tzLine = `🕒 時區：${s.scriptTimeZone}`;
  const nowLine = `現在：${s.nowText}`;

  FormApp.getUi().alert([acceptingLine, deadlineLine, nowLine, tzLine].join("\n"));
}

/** 觸發器呼叫：到期自動關閉回應 */
function deadlineCloseJob() {
  const form = FormApp.getActiveForm();
  form.setAcceptingResponses(false);

  // 寄信通知
  try {
    const email = Session.getEffectiveUser().getEmail();
    const title = getFormName_(form);

    // 取得適合閱讀的時間格式 (Script TimeZone)
    const nowStr = formatDateForDisplay_(new Date());

    const subject = `${title} ${nowStr} 已關閉填單`;
    const body = `您的表單「${title}」已於 ${nowStr} 達到設定期限，系統已自動關閉其回應功能。\n\n管理連結：${form.getEditUrl()}`;

    MailApp.sendEmail({
      to: email,
      subject: subject,
      body: body
    });
    console.log(`Sent closure email to ${email}`);
  } catch (e) {
    console.error("Failed to send email: " + e.message);
  }
}

/** ===== helpers ===== */

function ensureDeadlineTrigger_() {
  const iso = PropertiesService.getDocumentProperties().getProperty(PROP_KEY);
  if (!iso) return;

  const hasTrigger = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction && t.getHandlerFunction() === TRIGGER_FN);

  // 若沒有 trigger，補建一個 (只對未來的時間補)
  if (!hasTrigger) {
    const deadline = new Date(iso);
    if (!isNaN(deadline.getTime()) && deadline > new Date()) {
      ScriptApp.newTrigger(TRIGGER_FN)
        .timeBased()
        .at(deadline)
        .create();
    }
  }
}

function deleteDeadlineTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction && t.getHandlerFunction() === TRIGGER_FN) {
      ScriptApp.deleteTrigger(t);
    }
  });
}

/** 測試發信功能 */
function sendTestEmail() {
  const email = Session.getEffectiveUser().getEmail();
  const form = FormApp.getActiveForm();
  const title = getFormName_(form);

  if (!email) {
    throw new Error("無法取得使用者 Email，請確認權限。");
  }

  MailApp.sendEmail({
    to: email,
    subject: `測試信：${title}`,
    body: `這是一封測試郵件，確認您的表單「${title}」可以正常發送通知。\n\n管理連結：${form.getEditUrl()}`
  });

  return `已發送測試信至：${email}`;
}

/**
 * 以 Script 時區顯示（方便你在台灣看）
 */
function formatDateForDisplay_(dateObj) {
  const tz = Session.getScriptTimeZone();
  return Utilities.formatDate(dateObj, tz, "yyyy-MM-dd HH:mm:ss");
}

/** 取得表單名稱 (如果標題空白，嘗試抓檔名) */
function getFormName_(form) {
  let name = form.getTitle();
  if (!name) {
    try {
      name = DriveApp.getFileById(form.getId()).getName();
    } catch (e) {
      console.warn("DriveApp access failed:", e);
    }
  }
  return name || "（無標題表單）";
}
