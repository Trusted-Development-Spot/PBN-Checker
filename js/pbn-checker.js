/**
 * PBN Skye — PBN Footprint & Domain Neighborhood Checker Engine
 * Performs 100% client-side DNS, IP/ASN, and HTML footprint scans
 */

(function () {
  'use strict';

  // Sample domains demonstrating a realistic mix of isolated hosts and typical footprint collisions
  const SAMPLE_DOMAINS = [
    'techpulsehub.com',
    'cloudmetricsblog.org',
    'gadgetreviewzone.net',
    'devtutorialspro.io',
    'apexhostingguides.com'
  ];

  // DOM Elements
  let domainsInput;
  let runAuditBtn;
  let loadSampleBtn;
  let clearBtn;
  let exportCsvBtn;
  let progressContainer;
  let progressBar;
  let progressText;
  let currentDomainStatus;
  let resultsContainer;
  let resultsTableBody;
  let emptyState;
  let scoreCard;
  let scoreValueEl;
  let scoreBarEl;
  let scoreVerdictEl;
  let scoreBreakdownEl;
  let totalDomainsEl;
  let uniqueIpsEl;
  let uniqueCClassesEl;
  let conflictsDetectedEl;

  // State
  let auditedDomains = [];
  let isAuditing = false;

  function initElements() {
    domainsInput = document.getElementById('domains-input');
    runAuditBtn = document.getElementById('run-audit-btn');
    loadSampleBtn = document.getElementById('load-sample-btn');
    clearBtn = document.getElementById('clear-btn');
    exportCsvBtn = document.getElementById('export-csv-btn');
    progressContainer = document.getElementById('audit-progress-container');
    progressBar = document.getElementById('audit-progress-bar');
    progressText = document.getElementById('audit-progress-text');
    currentDomainStatus = document.getElementById('current-domain-status');
    resultsContainer = document.getElementById('results-container');
    resultsTableBody = document.getElementById('results-table-body');
    emptyState = document.getElementById('empty-state');
    scoreCard = document.getElementById('score-card');
    scoreValueEl = document.getElementById('score-value');
    scoreBarEl = document.getElementById('score-bar');
    scoreVerdictEl = document.getElementById('score-verdict');
    scoreBreakdownEl = document.getElementById('score-breakdown');
    totalDomainsEl = document.getElementById('stat-total-domains');
    uniqueIpsEl = document.getElementById('stat-unique-ips');
    uniqueCClassesEl = document.getElementById('stat-unique-cclasses');
    conflictsDetectedEl = document.getElementById('stat-conflicts-detected');
  }

  function cleanDomainName(raw) {
    if (!raw) return '';
    let domain = raw.trim().toLowerCase();
    domain = domain.replace(/^https?:\/\//i, '');
    domain = domain.replace(/^www\./i, '');
    domain = domain.split('/')[0].split('?')[0].split('#')[0];
    domain = domain.trim();
    return domain;
  }

  function isValidDomain(domain) {
    if (!domain || domain.length < 3 || domain.length > 253) return false;
    const domainRegex = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
    return domainRegex.test(domain);
  }

  function getCClass(ip) {
    if (!ip || !ip.includes('.')) return 'N/A';
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
    }
    return ip;
  }

  // --- Real Client-Side API Scanners ---

  // 1. Google DNS-over-HTTPS
  async function resolveDns(domain, recordType = 'A') {
    try {
      const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${recordType}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Google DoH returned status ${res.status}`);
      const data = await res.json();

      if (data && data.Answer && Array.isArray(data.Answer)) {
        if (recordType === 'A') {
          // type 1 is A record
          const aRecords = data.Answer.filter((ans) => ans.type === 1).map((ans) => ans.data);
          return aRecords;
        } else if (recordType === 'NS') {
          // type 2 is NS record
          const nsRecords = data.Answer.filter((ans) => ans.type === 2).map((ans) =>
            ans.data.replace(/\.$/, '').toLowerCase()
          );
          return nsRecords;
        }
      }
      return [];
    } catch (err) {
      // Fallback to Cloudflare DoH if Google DoH is blocked or fails
      try {
        const cfUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${recordType}`;
        const cfRes = await fetch(cfUrl, { headers: { Accept: 'application/dns-json' } });
        if (cfRes.ok) {
          const cfData = await cfRes.json();
          if (cfData && cfData.Answer && Array.isArray(cfData.Answer)) {
            if (recordType === 'A') {
              return cfData.Answer.filter((ans) => ans.type === 1).map((ans) => ans.data);
            } else if (recordType === 'NS') {
              return cfData.Answer.filter((ans) => ans.type === 2).map((ans) =>
                ans.data.replace(/\.$/, '').toLowerCase()
              );
            }
          }
        }
      } catch (fallbackErr) {
        console.warn(`DNS lookup failed for ${domain} (${recordType})`, fallbackErr);
      }
      return [];
    }
  }

  // 2. IP / ASN & Geolocation Lookup
  const ipCache = {};
  async function lookupIpInfo(ip) {
    if (!ip || ip === 'N/A' || ip.includes(':')) {
      return { isp: 'Unknown ISP', asn: 'Unknown ASN', country: 'Unknown', countryCode: 'XX' };
    }

    if (ipCache[ip]) {
      return ipCache[ip];
    }

    try {
      // Try ipwho.is first as it has high free limits and allows CORS
      const res = await fetch(`https://ipwho.is/${ip}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          const info = {
            isp: data.connection?.isp || data.connection?.org || 'Hosting Provider',
            asn: data.connection?.asn ? `AS${data.connection.asn}` : 'Unknown ASN',
            country: data.country || 'Unknown',
            countryCode: data.country_code || 'XX'
          };
          ipCache[ip] = info;
          return info;
        }
      }
    } catch (e) {
      // ignore and try fallback
    }

    try {
      // Secondary fallback: ipapi.co
      const res2 = await fetch(`https://ipapi.co/${ip}/json/`);
      if (res2.ok) {
        const data2 = await res2.json();
        const info = {
          isp: data2.org || data2.asn || 'Hosting Provider',
          asn: data2.asn || 'Unknown ASN',
          country: data2.country_name || 'Unknown',
          countryCode: data2.country_code || 'XX'
        };
        ipCache[ip] = info;
        return info;
      }
    } catch (e2) {
      // Final fallback
    }

    // Default fallback if rate-limited or offline
    const fallback = { isp: 'Standard Cloud / CDN', asn: 'Autonomous System', country: 'Global', countryCode: 'GL' };
    ipCache[ip] = fallback;
    return fallback;
  }

  // 3. Scan Homepage HTML for Tracking IDs and CMS Themes via Public CORS proxy
  async function scanHtmlFootprints(domain) {
    const results = {
      analytics: [],
      adsense: [],
      gtm: [],
      theme: 'Not Detected',
      htmlScanned: false
    };

    try {
      // Try allorigins.win CORS proxy
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent('https://' + domain)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6500);

      const res = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const html = data.contents || '';
        if (html && typeof html === 'string') {
          results.htmlScanned = true;

          // Google Analytics (Universal Analytics: UA-XXXXX-X, GA4: G-XXXXXXXXXX)
          const uaMatches = html.match(/UA-\d+-\d+/gi) || [];
          const ga4Matches = html.match(/G-[A-Z0-9]{7,12}/gi) || [];
          const allGa = Array.from(new Set([...uaMatches, ...ga4Matches]));
          results.analytics = allGa;

          // Google AdSense Publisher IDs: pub-XXXXXXXX or ca-pub-XXXXXXXX
          const pubMatches = html.match(/(?:ca-)?pub-\d{10,20}/gi) || [];
          results.adsense = Array.from(new Set(pubMatches));

          // Google Tag Manager IDs: GTM-XXXXXXX
          const gtmMatches = html.match(/GTM-[A-Z0-9]{5,10}/gi) || [];
          results.gtm = Array.from(new Set(gtmMatches));

          // WordPress Theme detection: /wp-content/themes/{themename}/
          const themeMatch = html.match(/\/wp-content\/themes\/([a-zA-Z0-9_-]+)/i);
          if (themeMatch && themeMatch[1]) {
            results.theme = `WordPress (${themeMatch[1]})`;
          } else if (html.includes('cdn.shopify.com')) {
            results.theme = 'Shopify';
          } else if (html.includes('static.wixstatic.com')) {
            results.theme = 'Wix';
          } else if (html.includes('assets.squarespace.com')) {
            results.theme = 'Squarespace';
          } else if (html.includes('ghost.org') || html.includes('ghost-portal')) {
            results.theme = 'Ghost CMS';
          }
        }
      }
    } catch (e) {
      // CORS proxy failure or timeout - gracefully return empty scan
      console.warn(`HTML scan unavailable for ${domain}`);
    }

    return results;
  }

  // --- Audit Execution Pipeline ---
  async function auditDomain(domain) {
    const item = {
      domain,
      ip: 'NXDOMAIN',
      allIps: [],
      cClass: 'N/A',
      nameservers: [],
      isp: 'Unknown',
      asn: 'Unknown',
      country: 'Unknown',
      countryCode: 'XX',
      analytics: [],
      adsense: [],
      gtm: [],
      theme: 'Not Detected',
      htmlScanned: false,
      status: 'Resolving DNS...',
      conflicts: []
    };

    // Step 1: DNS A & NS
    const [ips, nameservers] = await Promise.all([
      resolveDns(domain, 'A'),
      resolveDns(domain, 'NS')
    ]);

    if (ips && ips.length > 0) {
      item.ip = ips[0];
      item.allIps = ips;
      item.cClass = getCClass(ips[0]);
    }

    if (nameservers && nameservers.length > 0) {
      item.nameservers = nameservers;
    }

    // Step 2: IP Info
    if (item.ip !== 'NXDOMAIN') {
      const ipInfo = await lookupIpInfo(item.ip);
      item.isp = ipInfo.isp;
      item.asn = ipInfo.asn;
      item.country = ipInfo.country;
      item.countryCode = ipInfo.countryCode;
    }

    // Step 3: Scan HTML Footprints
    if (item.ip !== 'NXDOMAIN') {
      const htmlData = await scanHtmlFootprints(domain);
      item.analytics = htmlData.analytics;
      item.adsense = htmlData.adsense;
      item.gtm = htmlData.gtm;
      item.theme = htmlData.theme;
      item.htmlScanned = htmlData.htmlScanned;
    }

    item.status = item.ip === 'NXDOMAIN' ? 'Unresolved' : 'Active';
    return item;
  }

  // --- Conflict Detection Engine ---
  function analyzeConflicts(domainsList) {
    // Maps to track frequencies and clusters
    const ipMap = {};
    const cClassMap = {};
    const nsMap = {};
    const trackingMap = {};
    const themeMap = {};

    domainsList.forEach((d) => {
      d.conflicts = [];

      // IP Map
      if (d.ip && d.ip !== 'NXDOMAIN') {
        if (!ipMap[d.ip]) ipMap[d.ip] = [];
        ipMap[d.ip].push(d.domain);
      }

      // C-Class Map
      if (d.cClass && d.cClass !== 'N/A') {
        if (!cClassMap[d.cClass]) cClassMap[d.cClass] = [];
        cClassMap[d.cClass].push(d.domain);
      }

      // Nameserver Map
      d.nameservers.forEach((ns) => {
        if (!nsMap[ns]) nsMap[ns] = [];
        nsMap[ns].push(d.domain);
      });

      // Tracking IDs (Analytics, AdSense, GTM)
      const allTracking = [...d.analytics, ...d.adsense, ...d.gtm];
      allTracking.forEach((id) => {
        if (!trackingMap[id]) trackingMap[id] = [];
        trackingMap[id].push(d.domain);
      });

      // Theme Map
      if (d.theme && d.theme !== 'Not Detected') {
        if (!themeMap[d.theme]) themeMap[d.theme] = [];
        themeMap[d.theme].push(d.domain);
      }
    });

    let totalConflictCount = 0;

    // Cross-link detected conflicts into each domain
    domainsList.forEach((d) => {
      // 1. Same exact IP
      if (d.ip && ipMap[d.ip] && ipMap[d.ip].length > 1) {
        const peers = ipMap[d.ip].filter((dom) => dom !== d.domain);
        d.conflicts.push({
          type: 'EXACT_IP',
          severity: 'critical',
          title: 'Shared IP Address',
          detail: `Shares exact IP (${d.ip}) with ${peers.join(', ')}`
        });
        totalConflictCount++;
      }

      // 2. Same C-Class Subnet (only flag if not already flagged as exact IP)
      if (
        d.cClass &&
        cClassMap[d.cClass] &&
        cClassMap[d.cClass].length > 1 &&
        !(d.ip && ipMap[d.ip] && ipMap[d.ip].length > 1)
      ) {
        const peers = cClassMap[d.cClass].filter((dom) => dom !== d.domain);
        d.conflicts.push({
          type: 'C_CLASS',
          severity: 'warning',
          title: 'Shared C-Class Subnet',
          detail: `Same /24 subnet (${d.cClass}) as ${peers.join(', ')}`
        });
        totalConflictCount++;
      }

      // 3. Shared Nameservers
      d.nameservers.forEach((ns) => {
        if (nsMap[ns] && nsMap[ns].length > 1) {
          const peers = nsMap[ns].filter((dom) => dom !== d.domain);
          // Avoid duplicate NS warnings if multiple NS records match
          const already = d.conflicts.find((c) => c.type === 'NAMESERVER' && c.detail.includes(ns));
          if (!already) {
            d.conflicts.push({
              type: 'NAMESERVER',
              severity: 'warning',
              title: 'Shared Nameservers',
              detail: `Shares NS (${ns}) with ${peers.join(', ')}`
            });
            totalConflictCount++;
          }
        }
      });

      // 4. Shared Tracking IDs (Critical footprint)
      const allTracking = [...d.analytics, ...d.adsense, ...d.gtm];
      allTracking.forEach((id) => {
        if (trackingMap[id] && trackingMap[id].length > 1) {
          const peers = trackingMap[id].filter((dom) => dom !== d.domain);
          const already = d.conflicts.find((c) => c.type === 'TRACKING_ID' && c.detail.includes(id));
          if (!already) {
            d.conflicts.push({
              type: 'TRACKING_ID',
              severity: 'critical',
              title: 'Shared Tracking / AdSense ID',
              detail: `Linked by ID (${id}) on ${peers.join(', ')}`
            });
            totalConflictCount++;
          }
        }
      });

      // 5. Shared Custom Theme
      if (d.theme && d.theme.startsWith('WordPress (') && themeMap[d.theme] && themeMap[d.theme].length > 2) {
        const peers = themeMap[d.theme].filter((dom) => dom !== d.domain);
        d.conflicts.push({
          type: 'CMS_THEME',
          severity: 'info',
          title: 'Shared WordPress Theme',
          detail: `Identical custom theme structure as ${peers.join(', ')}`
        });
      }
    });

    return {
      ipMap,
      cClassMap,
      nsMap,
      trackingMap,
      themeMap,
      totalConflictCount
    };
  }

  // --- Calculate Network Isolation Score ---
  function computeIsolationScore(domainsList, analysis) {
    if (domainsList.length <= 1) {
      return { score: 100, verdict: 'Optimal Isolation', colorClass: 'text-emerald-600 dark:text-emerald-400', notes: [] };
    }

    let score = 100;
    const notes = [];

    // Count distinct shared entities
    let sharedIpClusters = 0;
    Object.keys(analysis.ipMap).forEach((ip) => {
      if (analysis.ipMap[ip].length > 1) sharedIpClusters++;
    });

    let sharedCClassClusters = 0;
    Object.keys(analysis.cClassMap).forEach((subnet) => {
      if (analysis.cClassMap[subnet].length > 1) sharedCClassClusters++;
    });

    let sharedTrackingIds = 0;
    Object.keys(analysis.trackingMap).forEach((id) => {
      if (analysis.trackingMap[id].length > 1) sharedTrackingIds++;
    });

    let sharedNsClusters = 0;
    Object.keys(analysis.nsMap).forEach((ns) => {
      if (analysis.nsMap[ns].length > 1) sharedNsClusters++;
    });

    if (sharedIpClusters > 0) {
      const penalty = Math.min(45, sharedIpClusters * 25);
      score -= penalty;
      notes.push(`-${penalty}% for ${sharedIpClusters} shared exact IP cluster(s)`);
    }

    if (sharedTrackingIds > 0) {
      const penalty = Math.min(50, sharedTrackingIds * 35);
      score -= penalty;
      notes.push(`-${penalty}% for ${sharedTrackingIds} shared Google Analytics/AdSense ID(s)`);
    }

    if (sharedCClassClusters > 0 && sharedIpClusters === 0) {
      const penalty = Math.min(30, sharedCClassClusters * 15);
      score -= penalty;
      notes.push(`-${penalty}% for ${sharedCClassClusters} shared C-Class subnet(s)`);
    }

    if (sharedNsClusters > 0) {
      const penalty = Math.min(20, sharedNsClusters * 10);
      score -= penalty;
      notes.push(`-${penalty}% for ${sharedNsClusters} shared nameserver host(s)`);
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    let verdict = 'Optimal Isolation';
    let colorClass = 'text-emerald-600 dark:text-emerald-400';
    if (score < 50) {
      verdict = 'High Footprint Hazard — Unsafe Network';
      colorClass = 'text-rose-600 dark:text-rose-400';
    } else if (score < 85) {
      verdict = 'Moderate Footprint Risk — Diversification Recommended';
      colorClass = 'text-amber-600 dark:text-amber-400';
    }

    return { score, verdict, colorClass, notes };
  }

  // --- Render Results Table & UI ---
  function renderAuditResults(domainsList, analysis) {
    emptyState.classList.add('hidden');
    resultsContainer.classList.remove('hidden');
    scoreCard.classList.remove('hidden');

    const scoreData = computeIsolationScore(domainsList, analysis);

    // Update Score Card
    scoreValueEl.textContent = `${scoreData.score}%`;
    scoreValueEl.className = `text-4xl font-extrabold tabular-nums ${scoreData.colorClass}`;
    scoreBarEl.style.width = `${scoreData.score}%`;

    if (scoreData.score >= 85) {
      scoreBarEl.className = 'h-full bg-emerald-500 rounded-full transition-all duration-500';
    } else if (scoreData.score >= 50) {
      scoreBarEl.className = 'h-full bg-amber-500 rounded-full transition-all duration-500';
    } else {
      scoreBarEl.className = 'h-full bg-rose-500 rounded-full transition-all duration-500';
    }

    scoreVerdictEl.textContent = scoreData.verdict;
    scoreVerdictEl.className = `text-sm font-semibold mt-1 ${scoreData.colorClass}`;

    if (scoreData.notes.length > 0) {
      scoreBreakdownEl.innerHTML = scoreData.notes
        .map((n) => `<li class="text-xs text-slate-500 dark:text-slate-400">${n}</li>`)
        .join('');
    } else {
      scoreBreakdownEl.innerHTML =
        '<li class="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Clean network architecture: zero overlapping footprints detected across tested domains.</li>';
    }

    // Update Quick Stats
    const totalCount = domainsList.length;
    const uniqueIps = new Set(domainsList.map((d) => d.ip).filter((ip) => ip !== 'NXDOMAIN')).size;
    const uniqueCClasses = new Set(domainsList.map((d) => d.cClass).filter((c) => c !== 'N/A')).size;
    const conflictDomainCount = domainsList.filter((d) => d.conflicts.length > 0).length;

    totalDomainsEl.textContent = totalCount;
    uniqueIpsEl.textContent = uniqueIps;
    uniqueCClassesEl.textContent = uniqueCClasses;
    conflictsDetectedEl.textContent = conflictDomainCount;

    // Render Table Rows
    resultsTableBody.innerHTML = '';
    domainsList.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.className =
        'hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors border-b border-slate-200/80 dark:border-slate-800 text-sm';

      const hasConflicts = item.conflicts.length > 0;

      // Status pill / text
      let statusHtml = '';
      if (hasConflicts) {
        const topConflict = item.conflicts[0];
        const isCrit = topConflict.severity === 'critical';
        statusHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
          isCrit
            ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50'
            : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50'
        }">${topConflict.title}</span>`;
      } else if (item.ip === 'NXDOMAIN') {
        statusHtml =
          '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">NXDOMAIN</span>';
      } else {
        statusHtml =
          '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50">Clean / Isolated</span>';
      }

      // Nameserver list
      const nsDisplay =
        item.nameservers.length > 0
          ? item.nameservers.slice(0, 2).join('<br>') +
            (item.nameservers.length > 2 ? `<span class="text-xs text-slate-400"> +${item.nameservers.length - 2} more</span>` : '')
          : '<span class="text-slate-400">None</span>';

      // Tracking IDs display
      const allTracking = [...item.analytics, ...item.adsense, ...item.gtm];
      const trackingDisplay =
        allTracking.length > 0
          ? allTracking.map((t) => `<span class="font-mono text-xs text-slate-700 dark:text-slate-300 block">${t}</span>`).join('')
          : '<span class="text-slate-400 text-xs">None</span>';

      // Conflict breakdown tooltips or notes
      const conflictNotes = item.conflicts
        .map((c) => `<div class="text-xs text-rose-600 dark:text-rose-400 mt-1 font-medium">• ${c.detail}</div>`)
        .join('');

      tr.innerHTML = `
        <td class="py-3.5 px-4 font-medium text-slate-900 dark:text-slate-100">
          <div class="flex items-center gap-2">
            <span class="text-slate-400 font-mono text-xs">${index + 1}.</span>
            <span class="font-semibold">${item.domain}</span>
          </div>
          ${conflictNotes}
        </td>
        <td class="py-3.5 px-4 font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300">
          ${item.ip}
        </td>
        <td class="py-3.5 px-4 font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300">
          ${item.cClass}
        </td>
        <td class="py-3.5 px-4 text-xs font-mono text-slate-600 dark:text-slate-400">
          ${nsDisplay}
        </td>
        <td class="py-3.5 px-4 text-xs text-slate-700 dark:text-slate-300">
          <div class="font-medium">${item.isp}</div>
          <div class="text-slate-400 text-[11px] font-mono">${item.asn} · ${item.country}</div>
        </td>
        <td class="py-3.5 px-4 text-xs">
          ${trackingDisplay}
        </td>
        <td class="py-3.5 px-4 text-xs text-slate-600 dark:text-slate-400">
          ${item.theme}
        </td>
        <td class="py-3.5 px-4 text-right">
          ${statusHtml}
        </td>
      `;
      resultsTableBody.appendChild(tr);
    });
  }

  // --- Export Audit to CSV ---
  function exportAuditToCsv() {
    if (!auditedDomains || auditedDomains.length === 0) return;

    const headers = [
      'Domain',
      'IP Address',
      'C-Class Subnet',
      'Nameservers',
      'ISP / Hosting Provider',
      'ASN',
      'Country',
      'Google Analytics IDs',
      'AdSense Publisher IDs',
      'GTM IDs',
      'CMS / Theme',
      'Conflict Count',
      'Footprint Flags'
    ];

    const rows = auditedDomains.map((d) => [
      `"${d.domain}"`,
      `"${d.ip}"`,
      `"${d.cClass}"`,
      `"${d.nameservers.join('; ')}"`,
      `"${d.isp.replace(/"/g, '""')}"`,
      `"${d.asn}"`,
      `"${d.country}"`,
      `"${d.analytics.join('; ')}"`,
      `"${d.adsense.join('; ')}"`,
      `"${d.gtm.join('; ')}"`,
      `"${d.theme.replace(/"/g, '""')}"`,
      d.conflicts.length,
      `"${d.conflicts.map((c) => `${c.title}: ${c.detail}`).join(' | ').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `pbn-skye-network-audit-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // --- Main Run Audit Handler ---
  async function runAudit() {
    if (isAuditing) return;

    const rawInput = domainsInput.value || '';
    const rawLines = rawInput.split('\n');
    const domainsToAudit = [];

    rawLines.forEach((line) => {
      const clean = cleanDomainName(line);
      if (clean && isValidDomain(clean) && !domainsToAudit.includes(clean)) {
        domainsToAudit.push(clean);
      }
    });

    if (domainsToAudit.length === 0) {
      alert('Please enter at least one valid domain name (e.g. example.com)');
      domainsInput.focus();
      return;
    }

    if (domainsToAudit.length > 15) {
      alert('Maximum 15 domains can be audited in a single batch to ensure fast client-side performance.');
      domainsToAudit.length = 15;
    }

    isAuditing = true;
    runAuditBtn.disabled = true;
    runAuditBtn.classList.add('opacity-75', 'cursor-not-allowed');
    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = `Auditing 0 of ${domainsToAudit.length} domains...`;

    auditedDomains = [];

    for (let i = 0; i < domainsToAudit.length; i++) {
      const dom = domainsToAudit[i];
      currentDomainStatus.textContent = `Scanning DNS & footprint signatures for: ${dom}...`;
      const percent = Math.round(((i) / domainsToAudit.length) * 100);
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `Auditing ${i + 1} of ${domainsToAudit.length} domains (${percent}%)...`;

      const result = await auditDomain(dom);
      auditedDomains.push(result);
    }

    progressBar.style.width = '100%';
    progressText.textContent = `Audit complete! Analyzing footprint conflicts...`;
    currentDomainStatus.textContent = `Cross-referencing IP subnets, nameservers, and tracking tags...`;

    // Cross-link conflict analysis
    const analysis = analyzeConflicts(auditedDomains);

    // Render results
    renderAuditResults(auditedDomains, analysis);

    // Reset progress UI
    setTimeout(() => {
      progressContainer.classList.add('hidden');
      isAuditing = false;
      runAuditBtn.disabled = false;
      runAuditBtn.classList.remove('opacity-75', 'cursor-not-allowed');
    }, 600);
  }

  // --- Sample Domains Loader ---
  function loadSampleDomains() {
    domainsInput.value = SAMPLE_DOMAINS.join('\n');
    runAudit();
  }

  // --- Clear Form ---
  function clearAudit() {
    domainsInput.value = '';
    auditedDomains = [];
    resultsTableBody.innerHTML = '';
    resultsContainer.classList.add('hidden');
    scoreCard.classList.add('hidden');
    emptyState.classList.remove('hidden');
  }

  // Init
  document.addEventListener('DOMContentLoaded', () => {
    initElements();

    if (runAuditBtn) runAuditBtn.addEventListener('click', runAudit);
    if (loadSampleBtn) loadSampleBtn.addEventListener('click', loadSampleDomains);
    if (clearBtn) clearBtn.addEventListener('click', clearAudit);
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportAuditToCsv);
  });
})();
