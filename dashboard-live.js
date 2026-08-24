(function (root) {
  'use strict';

  var CHANNEL_MAP = { shopify_d2c: 'd2c', shopify_b2b: 'b2b', amazon_us: 'amzus', amazon_uk: 'amzuk' };
  var REGION_MAP = { us: 'us', eur: 'eur', gb: 'gb', aus: 'aus', other: 'other' };

  function number(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function dateMs(value) {
    return Date.parse(String(value).slice(0, 10) + 'T00:00:00Z');
  }

  function emptyCell() {
    return { o:0, s:0, aovS:0, aovO:0, u:0, v:0, dsc:0, rfS:0, rfU:0, sh:0, tax:0, fee:0, cogs:0, ot:0 };
  }

  function normalize(payload, channels, regions) {
    var daily = Array.isArray(payload && payload.daily) ? payload.daily : [];
    var hourly = Array.isArray(payload && payload.hourly) ? payload.hourly : [];
    if (!daily.length) return { hasLiveData:false, days:[], payload:payload || {} };

    var byDay = new Map();
    function dayRecord(day) {
      if (byDay.has(day)) return byDay.get(day);
      var rec = { t:dateMs(day), ch:{}, reg:{}, cr:{}, o:0, s:0, aovS:0, aovO:0, u:0, v:0, dsc:0, rfS:0, rfU:0, sh:0, tax:0, fee:0, cogs:0, ot:0, hw:new Array(24).fill(0) };
      channels.forEach(function (channel) {
        rec.ch[channel.k] = emptyCell();
        rec.cr[channel.k] = regions.map(function () { return { o:0, s:0, aovS:0, aovO:0, dsc:0 }; });
      });
      regions.forEach(function (region) { rec.reg[region.k] = { o:0, s:0, aovS:0, aovO:0, dsc:0 }; });
      byDay.set(day, rec);
      return rec;
    }

    daily.forEach(function (row) {
      var channelKey = CHANNEL_MAP[row.channel];
      var regionKey = REGION_MAP[row.region_code];
      var channelIndex = channels.findIndex(function (item) { return item.k === channelKey; });
      var regionIndex = regions.findIndex(function (item) { return item.k === regionKey; });
      if (channelIndex < 0 || regionIndex < 0) return;
      var rec = dayRecord(row.day);
      var grossSales = number(row.gross_sales);
      var discounts = number(row.discounts);
      var sourceNetSales = Number(row.net_sales);
      var salesReversals = row.sales_reversals !== null && row.sales_reversals !== undefined
        ? number(row.sales_reversals)
        : (row.net_sales !== null && row.net_sales !== undefined && Number.isFinite(sourceNetSales)
          ? grossSales - discounts - sourceNetSales
          : number(row.refunds));
      var cell = {
        o:number(row.orders), s:grossSales,
        aovS:row.aov_sales !== null && row.aov_sales !== undefined ? number(row.aov_sales) : grossSales - discounts,
        aovO:row.aov_orders !== null && row.aov_orders !== undefined ? number(row.aov_orders) : number(row.orders),
        u:number(row.units), v:0,
        dsc:discounts, rfS:salesReversals, rfU:0,
        sh:number(row.shipping), tax:number(row.taxes), fee:number(row.return_fees),
        cogs:number(row.cogs), ot:number(row.fulfilled_on_time),
      };
      Object.keys(cell).forEach(function (key) { rec.ch[channelKey][key] += cell[key]; rec[key] += cell[key]; });
      rec.reg[regionKey].o += cell.o;
      rec.reg[regionKey].s += cell.s;
      rec.reg[regionKey].aovS += cell.aovS;
      rec.reg[regionKey].aovO += cell.aovO;
      rec.reg[regionKey].dsc += cell.dsc;
      rec.cr[channelKey][regionIndex].o += cell.o;
      rec.cr[channelKey][regionIndex].s += cell.s;
      rec.cr[channelKey][regionIndex].aovS += cell.aovS;
      rec.cr[channelKey][regionIndex].aovO += cell.aovO;
      rec.cr[channelKey][regionIndex].dsc += cell.dsc;
    });

    hourly.forEach(function (row) {
      var rec = byDay.get(String(row.day));
      var hour = Math.max(0, Math.min(23, number(row.hour)));
      if (rec) rec.hw[hour] += number(row.orders);
    });

    var days = Array.from(byDay.values()).sort(function (a, b) { return a.t - b.t; });
    days.forEach(function (rec) {
      var hourTotal = rec.hw.reduce(function (sum, value) { return sum + value; }, 0);
      if (hourTotal > 0) rec.hw = rec.hw.map(function (value) { return value / hourTotal; });
      rec.ns = rec.s - rec.dsc - rec.rfS;
      rec.ts = rec.ns + rec.sh + rec.fee + rec.tax;
      rec.gp = rec.ns - rec.cogs;
      channels.forEach(function (channel) {
        var cell = rec.ch[channel.k];
        cell.ns = cell.s - cell.dsc - cell.rfS;
        cell.ts = cell.ns + cell.sh + cell.fee + cell.tax;
        cell.gp = cell.ns - cell.cogs;
      });
    });
    return { hasLiveData:true, days:days, payload:payload };
  }

  async function load(endpoint, start, end, section) {
    var url = endpoint + '?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end);
    if (section) url += '&section=' + encodeURIComponent(section);
    var response = await fetch(url, { headers:{ Accept:'application/json' }, credentials:'same-origin' });
    var body = await response.json().catch(function () { return null; });
    if (!response.ok || !body || body.status !== 'live') throw new Error(body && body.code || 'LIVE_DATA_UNAVAILABLE');
    return body.data;
  }

  function addDays(isoDate, days) {
    var timestamp = dateMs(isoDate) + days * 86400000;
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  function mergePayloads(parts, start, end) {
    var merged = {};
    var arrayKeys = ['daily', 'hourly', 'products', 'recentOrders'];
    var reconciliations = [];
    var coverageStarts = [];
    var coverageEnds = [];
    parts.forEach(function (part) {
      Object.keys(part || {}).forEach(function (key) {
        if (arrayKeys.indexOf(key) >= 0 || key === 'shopifyReconciliation') return;
        merged[key] = part[key];
      });
      arrayKeys.forEach(function (key) {
        if (Array.isArray(part && part[key])) merged[key] = (merged[key] || []).concat(part[key]);
      });
      if (part && part.shopifyReconciliation) reconciliations.push(part.shopifyReconciliation);
      if (part && part.coverageStart) coverageStarts.push(part.coverageStart);
      if (part && part.coverageEnd) coverageEnds.push(part.coverageEnd);
    });
    if (Array.isArray(merged.recentOrders)) {
      var seen = new Set();
      merged.recentOrders = merged.recentOrders.filter(function (order) {
        var key = [order.order_name, order.processed_at, order.total_sales].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort(function (a, b) { return String(b.processed_at || '').localeCompare(String(a.processed_at || '')); }).slice(0, 100);
    }
    if (reconciliations.length) {
      var issue = reconciliations.find(function (item) { return item.status !== 'reconciled' && item.status !== 'current_day_as_of_sync'; });
      var latest = reconciliations[reconciliations.length - 1];
      merged.shopifyReconciliation = Object.assign({}, latest, {
        requestedStart:start,
        requestedEnd:end,
        status:issue ? issue.status : latest.status,
        missingInitialOrders:reconciliations.reduce(function (sum, item) { return sum + number(item.missingInitialOrders); }, 0),
      });
    }
    if (coverageStarts.length) merged.coverageStart = coverageStarts.sort()[0];
    if (coverageEnds.length) merged.coverageEnd = coverageEnds.sort().slice(-1)[0];
    return merged;
  }

  async function loadRange(endpoint, start, end, section) {
    var chunks = [];
    var cursor = start;
    while (cursor <= end) {
      var chunkEnd = addDays(cursor, 365);
      if (chunkEnd > end) chunkEnd = end;
      chunks.push([cursor, chunkEnd]);
      cursor = addDays(chunkEnd, 1);
    }
    var parts = [];
    for (var index = 0; index < chunks.length; index += 1) {
      var chunkSection = index === 0 ? section : 'overview';
      parts.push(await load(endpoint, chunks[index][0], chunks[index][1], chunkSection));
    }
    return mergePayloads(parts, start, end);
  }

  root.FlavourBlasterLive = { load:load, loadRange:loadRange, normalize:normalize };
})(window);
