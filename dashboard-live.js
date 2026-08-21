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
    return { o:0, s:0, u:0, v:0, dsc:0, rfS:0, rfU:0, sh:0, tax:0, fee:0, cogs:0, ot:0 };
  }

  function normalize(payload, channels, regions) {
    var daily = Array.isArray(payload && payload.daily) ? payload.daily : [];
    var hourly = Array.isArray(payload && payload.hourly) ? payload.hourly : [];
    if (!daily.length) return { hasLiveData:false, days:[], payload:payload || {} };

    var byDay = new Map();
    function dayRecord(day) {
      if (byDay.has(day)) return byDay.get(day);
      var rec = { t:dateMs(day), ch:{}, reg:{}, cr:{}, o:0, s:0, u:0, v:0, dsc:0, rfS:0, rfU:0, sh:0, tax:0, fee:0, cogs:0, ot:0, hw:new Array(24).fill(0) };
      channels.forEach(function (channel) {
        rec.ch[channel.k] = emptyCell();
        rec.cr[channel.k] = regions.map(function () { return { o:0, s:0, dsc:0 }; });
      });
      regions.forEach(function (region) { rec.reg[region.k] = { o:0, s:0, dsc:0 }; });
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
        o:number(row.orders), s:grossSales, u:number(row.units), v:0,
        dsc:discounts, rfS:salesReversals, rfU:0,
        sh:number(row.shipping), tax:number(row.taxes), fee:number(row.return_fees),
        cogs:number(row.cogs), ot:number(row.fulfilled_on_time),
      };
      Object.keys(cell).forEach(function (key) { rec.ch[channelKey][key] += cell[key]; rec[key] += cell[key]; });
      rec.reg[regionKey].o += cell.o;
      rec.reg[regionKey].s += cell.s;
      rec.reg[regionKey].dsc += cell.dsc;
      rec.cr[channelKey][regionIndex].o += cell.o;
      rec.cr[channelKey][regionIndex].s += cell.s;
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

  root.FlavourBlasterLive = { load:load, normalize:normalize };
})(window);
