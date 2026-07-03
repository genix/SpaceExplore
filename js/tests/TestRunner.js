// Zero-dependency browser test harness. Test files call Test.suite/Test.test to
// register; Test.run() executes them and renders a pass/fail checklist into
// #test-results, mirrors to the console, flips document.title to PASS/FAIL, and
// exposes window.__TEST_RESULT__ for a headless driver. See Testing.md.

// Assertions are globals so test bodies read as `assert(...)`, `assertEqual(...)`.
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEqual failed'}\n  expected: ${_fmt(expected)}\n  actual:   ${_fmt(actual)}`);
  }
}

function assertClose(a, b, epsilon, msg) {
  if (Math.abs(a - b) > (epsilon ?? 1e-9)) {
    throw new Error(`${msg || 'assertClose failed'}\n  expected: ${b} ± ${epsilon}\n  actual:   ${a}`);
  }
}

function assertThrows(fn, msg) {
  let threw = false;
  try { fn(); } catch (_) { threw = true; }
  if (!threw) throw new Error(msg || 'expected function to throw');
}

function assertDeepEqual(actual, expected, msg) {
  const diff = _deepDiff(actual, expected, '');
  if (diff) {
    throw new Error(`${msg || 'assertDeepEqual failed'}\n  first difference at: ${diff.path || '<root>'}` +
      `\n  expected: ${_fmt(diff.b)}\n  actual:   ${_fmt(diff.a)}`);
  }
}

function _deepDiff(a, b, path) {
  if (a === b) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return { path, a, b };
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = _deepDiff(a[k], b[k], path ? `${path}.${k}` : k);
      if (d) return d;
    }
    return null;
  }
  return { path, a, b };
}

function _fmt(v) {
  let s;
  try { s = typeof v === 'object' ? JSON.stringify(v) : String(v); }
  catch (_) { s = String(v); }
  return s && s.length > 200 ? s.slice(0, 200) + '…' : s;
}

const Test = (() => {
  const tests = [];
  const globalHooks = { before: [], after: [] };
  let ctx = null;

  function suite(name, fn) {
    const prev = ctx;
    ctx = { name, before: [], after: [] };
    try { fn(); } finally { ctx = prev; }
  }

  function test(name, fn) {
    const c = ctx || { name: null, ...globalHooks };
    tests.push({ suite: c.name, name, fn, before: c.before, after: c.after });
  }

  function beforeEach(fn) { (ctx ? ctx.before : globalHooks.before).push(fn); }
  function afterEach(fn)  { (ctx ? ctx.after  : globalHooks.after ).push(fn); }

  async function run() {
    const results = [];
    for (const t of tests) {
      const rec = { suite: t.suite, name: t.name, passed: true, error: null };
      try {
        for (const fn of t.before) await fn();
        await t.fn();
      } catch (e) {
        rec.passed = false;
        rec.error = e;
      } finally {
        try { for (const fn of t.after) await fn(); }
        catch (e) { if (rec.passed) { rec.passed = false; rec.error = e; } }
      }
      results.push(rec);
      _log(rec);
    }
    _render(results);
    return results;
  }

  function _log(r) {
    if (r.passed) console.log('%c✓ ' + r.name, 'color:#4c4');
    else console.error('✗ ' + r.name, r.error);
  }

  function _render(results) {
    const root = document.getElementById('test-results');
    let passed = 0, failed = 0, lastSuite;
    if (root) root.innerHTML = '';

    for (const r of results) {
      if (r.passed) passed++; else failed++;
      if (!root) continue;

      if (r.suite !== lastSuite) {
        lastSuite = r.suite;
        if (r.suite) {
          const hdr = document.createElement('h3');
          hdr.textContent = r.suite;
          hdr.style.cssText = 'margin:14px 0 4px;color:#88ccff;font-family:monospace';
          root.appendChild(hdr);
        }
      }

      const row = document.createElement('div');
      row.style.cssText = 'font-family:monospace;white-space:pre-wrap;margin:2px 0';
      if (r.passed) {
        row.style.color = '#44cc44';
        row.textContent = '✓ ' + r.name;
      } else {
        row.style.color = '#ff5555';
        const msg = r.error && r.error.message ? r.error.message : String(r.error);
        row.textContent = `✗ ${r.name} — ${msg}`;
        if (r.error && r.error.stack) {
          const det = document.createElement('div');
          det.style.cssText = 'color:#aa8888;margin-left:16px;font-size:11px';
          det.textContent = r.error.stack;
          row.appendChild(det);
        }
      }
      root.appendChild(row);
    }

    if (root) {
      const summary = document.createElement('div');
      summary.style.cssText =
        `margin-top:14px;font-family:monospace;font-weight:bold;color:${failed ? '#ff5555' : '#44cc44'}`;
      summary.textContent = `${passed} passed, ${failed} failed`;
      root.appendChild(summary);
    }

    document.title = failed ? 'FAIL' : 'PASS';
    window.__TEST_RESULT__ = { passed, failed, total: results.length };
    console.log(`%c${passed} passed, ${failed} failed`, `color:${failed ? '#f55' : '#4c4'};font-weight:bold`);
  }

  return { suite, test, beforeEach, afterEach, run };
})();
