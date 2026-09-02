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
    return { o:0, s:0, aovS:0, aovO:0, u:0, v:0, dsc:0, rfS:0, rfU:0, sh:0, tax:0, fee:0, cogs:0, ot:0, costedU:0, uncostedU:0, covRows:0, covKnown:0 };
  }

  function addCell(target, source) {
    Object.keys(emptyCell()).forEach(function (key) { target[key] += number(source[key]); });
  }

  function financeStatus(aggregate) {
    var rowCount = number(aggregate && aggregate.covRows);
    var knownRows = number(aggregate && aggregate.covKnown);
    var costedUnits = number(aggregate && aggregate.costedU);
    var uncostedUnits = number(aggregate && aggregate.uncostedU);
    var coverageKnown = rowCount > 0 && knownRows === rowCount;
    var cogsComplete = coverageKnown && uncostedUnits === 0;
    var cogsReason = cogsComplete ? '' : !coverageKnown
      ? 'Cost coverage metadata unavailable'
      : 'Incomplete cost coverage';
    return {
      coverageKnown:coverageKnown,
      cogsComplete:cogsComplete,
      cogsReason:cogsReason,
      costedUnits:costedUnits,
      uncostedUnits:uncostedUnits,
      grossProfitComplete:cogsComplete,
      adSpendComplete:false,
      fulfilmentComplete:false,
      paymentFeesComplete:false,
      contributionComplete:false,
    };
  }

  function cumulative(days, field) {
    var total = 0;
    return (Array.isArray(days) ? days : []).map(function (day) {
      total += number(day && day[field]);
      return total;
    });
  }

  function financeChange(current, previous, lowerIsBetter) {
    current = number(current);
    previous = number(previous);
    var difference = current - previous;
    var direction = difference === 0 ? 0 : difference > 0 ? 1 : -1;
    var favorable = direction === 0 ? null : lowerIsBetter ? direction < 0 : direction > 0;
    return {
      difference:difference,
      direction:direction,
      favorable:favorable,
      percent:previous === 0 ? null : difference / Math.abs(previous),
      zeroBaseline:previous === 0,
    };
  }

  function normalize(payload, channels, regions) {
    var daily = Array.isArray(payload && payload.daily) ? payload.daily : [];
    var hourly = Array.isArray(payload && payload.hourly) ? payload.hourly : [];
    if (!daily.length) return { hasLiveData:false, days:[], payload:payload || {} };

    var byDay = new Map();
    function dayRecord(day) {
      if (byDay.has(day)) return byDay.get(day);
      var rec = Object.assign({ t:dateMs(day), ch:{}, reg:{}, cr:{}, hcr:{}, hw:new Array(24).fill(0) }, emptyCell());
      channels.forEach(function (channel) {
        rec.ch[channel.k] = emptyCell();
        rec.cr[channel.k] = regions.map(function () { return emptyCell(); });
        rec.hcr[channel.k] = regions.map(function () { return new Array(24).fill(0); });
      });
      regions.forEach(function (region) { rec.reg[region.k] = emptyCell(); });
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
      var coverageKnown = Object.prototype.hasOwnProperty.call(row, 'costed_units') && Object.prototype.hasOwnProperty.call(row, 'uncosted_units');
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
        costedU:number(row.costed_units), uncostedU:number(row.uncosted_units),
        covRows:1, covKnown:coverageKnown ? 1 : 0,
      };
      addCell(rec.ch[channelKey], cell);
      addCell(rec, cell);
      addCell(rec.reg[regionKey], cell);
      addCell(rec.cr[channelKey][regionIndex], cell);
    });

    hourly.forEach(function (row) {
      var rec = byDay.get(String(row.day));
      var hour = Math.max(0, Math.min(23, number(row.hour)));
      if (!rec) return;
      var orders = number(row.orders);
      var channelKey = CHANNEL_MAP[row.channel];
      var regionKey = REGION_MAP[row.region_code];
      var regionIndex = regions.findIndex(function (item) { return item.k === regionKey; });
      rec.hw[hour] += orders;
      if (channelKey && rec.hcr[channelKey] && regionIndex >= 0) rec.hcr[channelKey][regionIndex][hour] += orders;
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
    var trafficParts = [];
    var reconciliations = [];
    var coverageStarts = [];
    var coverageEnds = [];
    parts.forEach(function (part) {
      Object.keys(part || {}).forEach(function (key) {
        if (arrayKeys.indexOf(key) >= 0 || key === 'shopifyReconciliation' || key === 'traffic') return;
        merged[key] = part[key];
      });
      arrayKeys.forEach(function (key) {
        if (Array.isArray(part && part[key])) merged[key] = (merged[key] || []).concat(part[key]);
      });
      if (part && part.shopifyReconciliation) reconciliations.push(part.shopifyReconciliation);
      if (part && part.traffic) trafficParts.push(part.traffic);
      if (part && part.coverageStart) coverageStarts.push(part.coverageStart);
      if (part && part.coverageEnd) coverageEnds.push(part.coverageEnd);
    });
    var uniqueKeys = {
      daily:function (row) { return [row.day, row.channel, row.region_code].join('|'); },
      hourly:function (row) { return [row.day, row.hour, row.channel, row.region_code].join('|'); },
    };
    Object.keys(uniqueKeys).forEach(function (key) {
      if (!Array.isArray(merged[key])) return;
      var byKey = new Map();
      merged[key].forEach(function (row) { byKey.set(uniqueKeys[key](row), row); });
      merged[key] = Array.from(byKey.values());
    });
    if (Array.isArray(merged.products)) {
      var productMap = new Map();
      var summedProductFields = ['cogs', 'units', 'refunds', 'net_sales', 'gross_sales', 'gross_profit', 'refunded_units'];
      merged.products.forEach(function (row) {
        var key = String(row.shopify_variant_id || row.sku || row.title);
        if (!productMap.has(key)) { productMap.set(key, Object.assign({}, row)); return; }
        var product = productMap.get(key);
        summedProductFields.forEach(function (field) { product[field] = number(product[field]) + number(row[field]); });
      });
      merged.products = Array.from(productMap.values());
    }
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
    if (trafficParts.length) {
      var traffic = {
        status:'live', propertyId:298253309, coverageStart:null, coverageEnd:null,
        lastSuccessAt:null, provisionalThrough:null, daily:[], channelGroups:[],
        sourceMedium:[], countries:[], devices:[], landingPages:[],
      };
      var trafficArrays = ['daily', 'channelGroups', 'sourceMedium', 'countries', 'devices', 'landingPages'];
      var trafficStatusRank = { live:0, stale:1, unavailable:2 };
      trafficParts.forEach(function (part) {
        if ((trafficStatusRank[part.status] || 0) > (trafficStatusRank[traffic.status] || 0)) traffic.status = part.status;
        if (part.code) traffic.code = part.code;
        if (part.propertyId) traffic.propertyId = part.propertyId;
        if (part.coverageStart && (!traffic.coverageStart || part.coverageStart < traffic.coverageStart)) traffic.coverageStart = part.coverageStart;
        if (part.coverageEnd && (!traffic.coverageEnd || part.coverageEnd > traffic.coverageEnd)) traffic.coverageEnd = part.coverageEnd;
        if (part.lastSuccessAt && (!traffic.lastSuccessAt || part.lastSuccessAt > traffic.lastSuccessAt)) traffic.lastSuccessAt = part.lastSuccessAt;
        if (part.provisionalThrough && (!traffic.provisionalThrough || part.provisionalThrough > traffic.provisionalThrough)) traffic.provisionalThrough = part.provisionalThrough;
        if (part.generatedAt && (!traffic.generatedAt || part.generatedAt > traffic.generatedAt)) traffic.generatedAt = part.generatedAt;
        trafficArrays.forEach(function (key) {
          if (Array.isArray(part[key])) traffic[key] = traffic[key].concat(part[key]);
        });
      });
      trafficArrays.forEach(function (key) {
        var seen = new Map();
        traffic[key].forEach(function (row) {
          var rowKey = key === 'daily' ? String(row.day) : [row.day, row.key, row.regionCode || ''].join('|');
          seen.set(rowKey, row);
        });
        traffic[key] = Array.from(seen.values()).sort(function (a, b) {
          return String(a.day || '').localeCompare(String(b.day || '')) || number(b.sessions) - number(a.sessions);
        });
      });
      merged.traffic = traffic;
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

  root.FlavourBlasterLive = { load:load, loadRange:loadRange, mergePayloads:mergePayloads, normalize:normalize, financeStatus:financeStatus, cumulative:cumulative, financeChange:financeChange };
})(window);
