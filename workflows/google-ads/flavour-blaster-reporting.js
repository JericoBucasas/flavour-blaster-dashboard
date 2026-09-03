/**
 * Flavour Blaster Google Ads reporting export.
 *
 * Install this source in customer 932-938-7049 only after reviewing it and
 * replacing the two placeholders below inside Google Ads. The repository copy
 * must never contain the live webhook URL or sync key.
 *
 * This script is deliberately read-only in Google Ads. It uses reporting
 * searches and sends aggregate results to the protected n8n ingestion webhook.
 */

var CONFIG = Object.freeze({
  SCHEMA_VERSION: 1,
  CUSTOMER_ID: '9329387049',
  CURRENCY_CODE: 'GBP',
  TIME_ZONE: 'Europe/London',
  WEBHOOK_URL: 'https://REPLACE_WITH_N8N_WEBHOOK_URL',
  SYNC_KEY: 'REPLACE_WITH_RANDOM_32_BYTE_OR_LONGER_SECRET',
  HISTORICAL_FLOOR: '2025-01-01',
  ROLLING_DAYS: 4,
  CORRECTION_DAYS: 35,
  CORRECTION_HOUR: '03',
  SAMPLE_DATE: '',
});

var EU_COUNTRIES = Object.freeze([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE',
  'IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
]);

function main() {
  validateConfiguration();
  validateAccount();

  var today = londonDate(new Date());
  var sampleMode = /^\d{4}-\d{2}-\d{2}$/.test(CONFIG.SAMPLE_DATE);
  if (sampleMode && CONFIG.SAMPLE_DATE >= today) throw new Error('GOOGLE_ADS_SAMPLE_DATE_MUST_BE_COMPLETE');
  var windows = sampleMode ? [{ mode:'correction', start:CONFIG.SAMPLE_DATE, end:CONFIG.SAMPLE_DATE }] : [{
    mode: 'incremental',
    start: addDays(today, -(CONFIG.ROLLING_DAYS - 1)),
    end: today,
  }];
  if (!sampleMode && Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'HH') === CONFIG.CORRECTION_HOUR) {
    windows.push({ mode:'correction', start:addDays(today, -(CONFIG.CORRECTION_DAYS - 1)), end:today });
  }

  var preview = AdsApp.getExecutionInfo().isPreview();
  var nextBackfillWindow = null;
  for (var index = 0; index < windows.length; index += 1) {
    var payload = buildPayload(windows[index]);
    if (preview) {
      logPreview(payload);
      continue;
    }
    var response = postPayload(payload);
    if (response && response.nextBackfillWindow) nextBackfillWindow = response.nextBackfillWindow;
  }

  if (!preview && !sampleMode && nextBackfillWindow) {
    validateWindow(nextBackfillWindow, 'backfill');
    postPayload(buildPayload({
      mode:'backfill',
      start:nextBackfillWindow.start,
      end:nextBackfillWindow.end,
    }));
  }
}

function validateConfiguration() {
  if (CONFIG.WEBHOOK_URL.indexOf('REPLACE_WITH_') >= 0 || !/^https:\/\//.test(CONFIG.WEBHOOK_URL)) {
    throw new Error('GOOGLE_ADS_WEBHOOK_NOT_CONFIGURED');
  }
  if (CONFIG.SYNC_KEY.indexOf('REPLACE_WITH_') >= 0 || CONFIG.SYNC_KEY.length < 43) {
    throw new Error('GOOGLE_ADS_SYNC_KEY_NOT_CONFIGURED');
  }
  if (CONFIG.SAMPLE_DATE && !/^\d{4}-\d{2}-\d{2}$/.test(CONFIG.SAMPLE_DATE)) {
    throw new Error('GOOGLE_ADS_SAMPLE_DATE_INVALID');
  }
}

function validateAccount() {
  var account = AdsApp.currentAccount();
  var customerId = String(account.getCustomerId() || '').replace(/\D/g, '');
  if (customerId !== CONFIG.CUSTOMER_ID) throw new Error('GOOGLE_ADS_CUSTOMER_MISMATCH:' + customerId);
  if (account.getCurrencyCode() !== CONFIG.CURRENCY_CODE) throw new Error('GOOGLE_ADS_CURRENCY_MISMATCH');
  if (account.getTimeZone() !== CONFIG.TIME_ZONE) throw new Error('GOOGLE_ADS_TIME_ZONE_MISMATCH');
}

function buildPayload(window) {
  validateWindow(window, window.mode);
  var campaignDaily = readCampaignDaily(window.start, window.end);
  var countryRows = readCampaignCountryDaily(window.start, window.end);
  var countryCodes = resolveCountryCodes(countryRows);
  var campaignCountryDaily = countryRows.map(function (row) {
    var countryCode = countryCodes[row.countryCriterionId] || '';
    return Object.assign({}, row, {
      countryCode:countryCode,
      regionCode:regionCode(countryCode),
    });
  });
  return {
    schemaVersion:CONFIG.SCHEMA_VERSION,
    source:'google_ads',
    customerId:CONFIG.CUSTOMER_ID,
    currencyCode:CONFIG.CURRENCY_CODE,
    timeZone:CONFIG.TIME_ZONE,
    mode:window.mode,
    window:{ start:window.start, end:window.end },
    generatedAt:new Date().toISOString(),
    requestId:Utilities.getUuid(),
    campaignDaily:campaignDaily,
    campaignCountryDaily:campaignCountryDaily,
  };
}

function readCampaignDaily(start, end) {
  var query = [
    'SELECT segments.date, campaign.id, campaign.name, campaign.status,',
    'campaign.advertising_channel_type, campaign.advertising_channel_sub_type,',
    'metrics.cost_micros, metrics.impressions, metrics.clicks,',
    'metrics.conversions, metrics.conversions_value',
    'FROM campaign',
    "WHERE segments.date BETWEEN '" + start + "' AND '" + end + "'",
  ].join(' ');
  var rows = [];
  var iterator = AdsApp.search(query);
  while (iterator.hasNext()) {
    var row = iterator.next();
    var metrics = metricFields(row.metrics);
    if (!hasActivity(metrics)) continue;
    rows.push(Object.assign({
      day:String(row.segments.date),
      campaignId:String(row.campaign.id),
      campaignName:String(row.campaign.name || '').slice(0, 1024),
      campaignStatus:String(row.campaign.status || 'UNKNOWN'),
      channelType:String(row.campaign.advertisingChannelType || 'UNSPECIFIED'),
      channelSubtype:String(row.campaign.advertisingChannelSubType || 'UNSPECIFIED'),
    }, metrics));
  }
  return rows;
}

function readCampaignCountryDaily(start, end) {
  var query = [
    'SELECT segments.date, campaign.id, user_location_view.country_criterion_id,',
    'user_location_view.targeting_location, metrics.cost_micros, metrics.impressions,',
    'metrics.clicks, metrics.conversions, metrics.conversions_value',
    'FROM user_location_view',
    "WHERE segments.date BETWEEN '" + start + "' AND '" + end + "'",
  ].join(' ');
  var rows = [];
  var iterator = AdsApp.search(query);
  while (iterator.hasNext()) {
    var row = iterator.next();
    var metrics = metricFields(row.metrics);
    if (!hasActivity(metrics)) continue;
    rows.push(Object.assign({
      day:String(row.segments.date),
      campaignId:String(row.campaign.id),
      countryCriterionId:String(row.userLocationView.countryCriterionId),
      targetingLocation:Boolean(row.userLocationView.targetingLocation),
    }, metrics));
  }
  return rows;
}

function resolveCountryCodes(rows) {
  var ids = [];
  var seen = {};
  rows.forEach(function (row) {
    if (!seen[row.countryCriterionId]) {
      seen[row.countryCriterionId] = true;
      ids.push(row.countryCriterionId);
    }
  });
  var result = {};
  for (var offset = 0; offset < ids.length; offset += 100) {
    var chunk = ids.slice(offset, offset + 100);
    var query = 'SELECT geo_target_constant.id, geo_target_constant.country_code ' +
      'FROM geo_target_constant WHERE geo_target_constant.id IN (' + chunk.join(',') + ')';
    var iterator = AdsApp.search(query);
    while (iterator.hasNext()) {
      var row = iterator.next();
      result[String(row.geoTargetConstant.id)] = String(row.geoTargetConstant.countryCode || '').toUpperCase();
    }
  }
  return result;
}

function metricFields(metrics) {
  return {
    costMicros:String(Math.max(0, Math.round(Number(metrics.costMicros) || 0))),
    impressions:Math.max(0, Math.round(Number(metrics.impressions) || 0)),
    clicks:Math.max(0, Math.round(Number(metrics.clicks) || 0)),
    conversions:Math.max(0, Number(metrics.conversions) || 0),
    conversionValue:Math.max(0, Number(metrics.conversionsValue) || 0),
  };
}

function hasActivity(metrics) {
  return Number(metrics.costMicros) > 0 || metrics.impressions > 0 || metrics.clicks > 0 ||
    metrics.conversions > 0 || metrics.conversionValue > 0;
}

function regionCode(countryCode) {
  if (countryCode === 'US') return 'us';
  if (countryCode === 'GB') return 'gb';
  if (countryCode === 'AU') return 'aus';
  return EU_COUNTRIES.indexOf(countryCode) >= 0 ? 'eur' : 'other';
}

function validateWindow(window, expectedMode) {
  if (!window || !/^\d{4}-\d{2}-\d{2}$/.test(window.start) || !/^\d{4}-\d{2}-\d{2}$/.test(window.end)) {
    throw new Error('GOOGLE_ADS_WINDOW_INVALID');
  }
  if (window.start > window.end || window.start < CONFIG.HISTORICAL_FLOOR) throw new Error('GOOGLE_ADS_WINDOW_INVALID');
  var days = Math.round((Date.parse(window.end + 'T00:00:00Z') - Date.parse(window.start + 'T00:00:00Z')) / 86400000) + 1;
  if (days > CONFIG.CORRECTION_DAYS) throw new Error('GOOGLE_ADS_WINDOW_TOO_LARGE');
  if (expectedMode && ['incremental','correction','backfill'].indexOf(expectedMode) < 0) throw new Error('GOOGLE_ADS_MODE_INVALID');
}

function postPayload(payload) {
  var response = UrlFetchApp.fetch(CONFIG.WEBHOOK_URL, {
    method:'post',
    contentType:'application/json',
    headers:{ 'X-FB-Ads-Sync-Key':CONFIG.SYNC_KEY },
    payload:JSON.stringify(payload),
    muteHttpExceptions:true,
  });
  var code = response.getResponseCode();
  var body = response.getContentText();
  if (code < 200 || code >= 300) throw new Error('GOOGLE_ADS_WEBHOOK_FAILED:' + code + ':' + body.slice(0, 240));
  var parsed = body ? JSON.parse(body) : {};
  Logger.log('Google Ads %s sync succeeded: %s to %s (%s campaign rows, %s geography rows)',
    payload.mode, payload.window.start, payload.window.end, payload.campaignDaily.length, payload.campaignCountryDaily.length);
  return parsed;
}

function logPreview(payload) {
  Logger.log('PREVIEW ONLY — no webhook request sent: %s to %s (%s campaign rows, %s geography rows)',
    payload.window.start, payload.window.end, payload.campaignDaily.length, payload.campaignCountryDaily.length);
}

function londonDate(date) {
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy-MM-dd');
}

function addDays(isoDate, offset) {
  var date = new Date(isoDate + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}
