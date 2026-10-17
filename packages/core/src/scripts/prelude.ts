/**
 * Código executado DENTRO do sandbox (QuickJS) antes do script do usuário.
 * Implementa o subconjunto mais usado da API do Postman: pm.environment,
 * pm.collectionVariables, pm.globals, pm.variables, pm.request, pm.response,
 * pm.test, pm.expect (chai), console e a API antiga postman.*.
 *
 * Comunica-se com o processo principal só pelas funções de `__host` e pelo
 * JSON em `__dataJson`. Não há require, fs, rede nem process.
 */
export const PRELUDE = String.raw`
(function () {
  var host = globalThis.__host;
  var data = JSON.parse(globalThis.__dataJson);
  var chai = globalThis.chai;

  function fmt(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.name + ': ' + value.message;
    try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }
  }
  function log(level) {
    return function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) parts.push(fmt(arguments[i]));
      host.log(level, parts.join(' '));
    };
  }
  globalThis.console = { log: log('log'), info: log('info'), warn: log('warn'), error: log('error'), debug: log('log') };

  function toText(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function scope(name) {
    return {
      get: function (k) { return host.getVar(name, String(k)); },
      set: function (k, v) { host.setVar(name, String(k), toText(v)); },
      unset: function (k) { host.unsetVar(name, String(k)); },
      has: function (k) { return host.hasVar(name, String(k)); },
      clear: function () { host.clearVars(name); },
      toObject: function () { return JSON.parse(host.toObject(name)); },
      replaceIn: function (s) { return host.replaceIn(String(s)); }
    };
  }

  function headerList(list, mutable) {
    function find(k) {
      var key = String(k).toLowerCase();
      for (var i = 0; i < list.length; i++) if (list[i].key.toLowerCase() === key) return list[i];
      return undefined;
    }
    var api = {
      get: function (k) { var h = find(k); return h ? h.value : undefined; },
      has: function (k, v) { var h = find(k); return !!h && (v === undefined || h.value === String(v)); },
      toObject: function () { var o = {}; list.forEach(function (h) { o[h.key] = h.value; }); return o; },
      all: function () { return list.map(function (h) { return { key: h.key, value: h.value }; }); },
      each: function (fn) { list.forEach(function (h) { fn({ key: h.key, value: h.value }); }); },
      count: function () { return list.length; }
    };
    if (mutable) {
      api.add = function (h) { list.push({ key: String(h.key), value: toText(h.value) }); };
      api.upsert = function (h) { var e = find(h.key); if (e) e.value = toText(h.value); else api.add(h); };
      api.remove = function (k) {
        var key = String(typeof k === 'object' ? k.key : k).toLowerCase();
        for (var i = list.length - 1; i >= 0; i--) if (list[i].key.toLowerCase() === key) list.splice(i, 1);
      };
    }
    return api;
  }

  // ---- pm.request -------------------------------------------------------
  var req = data.request;
  var pre = data.phase === 'pre';
  var request = {
    headers: headerList(req.headers, pre),
    body: {
      get raw() { return req.body; },
      set raw(v) { if (pre) req.body = String(v); },
      toString: function () { return req.body || ''; }
    }
  };
  Object.defineProperty(request, 'method', {
    get: function () { return req.method; },
    set: function (v) { if (pre) req.method = String(v).toUpperCase(); },
    enumerable: true
  });
  Object.defineProperty(request, 'url', {
    get: function () {
      return {
        toString: function () { return req.url; },
        getHost: function () { var m = /^[a-z]+:\/\/([^/:?#]+)/i.exec(req.url); return m ? m[1] : ''; },
        getPath: function () { var m = /^[a-z]+:\/\/[^/?#]+([^?#]*)/i.exec(req.url); return m ? m[1] || '/' : req.url; },
        update: function (u) { if (pre) req.url = String(u); }
      };
    },
    set: function (v) { if (pre) req.url = String(v); },
    enumerable: true
  });
  request.addHeader = function (h) { if (pre) request.headers.upsert(h); };
  request.removeHeader = function (k) { if (pre) request.headers.remove(k); };

  // ---- pm.response ------------------------------------------------------
  var response;
  if (data.response) {
    var res = data.response;
    var fail = function (message) { throw new chai.AssertionError(message); };
    var range = function (min, max, label) {
      return function () {
        if (res.status < min || res.status > max) fail('esperado status ' + label + ', mas veio ' + res.status);
      };
    };
    var be = {};
    Object.defineProperty(be, 'ok', { get: range(200, 299, '2xx') });
    Object.defineProperty(be, 'success', { get: range(200, 299, '2xx') });
    Object.defineProperty(be, 'redirection', { get: range(300, 399, '3xx') });
    Object.defineProperty(be, 'clientError', { get: range(400, 499, '4xx') });
    Object.defineProperty(be, 'serverError', { get: range(500, 599, '5xx') });
    Object.defineProperty(be, 'error', { get: range(400, 599, '4xx ou 5xx') });
    Object.defineProperty(be, 'json', {
      get: function () {
        try { JSON.parse(res.body); } catch (e) { fail('esperado corpo JSON válido'); }
      }
    });
    response = {
      code: res.status,
      status: res.statusText,
      responseTime: res.timeMs,
      responseSize: res.size,
      headers: headerList(res.headers, false),
      text: function () { return res.body; },
      json: function () {
        try { return JSON.parse(res.body); }
        catch (e) { throw new Error('A resposta não é um JSON válido: ' + e.message); }
      },
      to: {
        have: {
          status: function (expected) {
            if (typeof expected === 'number' && res.status !== expected) fail('esperado status ' + expected + ', mas veio ' + res.status);
            if (typeof expected === 'string' && res.statusText !== expected) fail('esperado status "' + expected + '", mas veio "' + res.statusText + '"');
          },
          header: function (name, value) {
            var actual = response.headers.get(name);
            if (actual === undefined) fail('esperado header "' + name + '"');
            if (value !== undefined && actual !== String(value)) fail('esperado header "' + name + '" = "' + value + '", mas veio "' + actual + '"');
          },
          body: function (expected) {
            if (expected !== undefined && res.body !== String(expected)) fail('o corpo da resposta é diferente do esperado');
          },
          jsonBody: function (path, value) {
            var body;
            try { body = JSON.parse(res.body); } catch (e) { fail('esperado corpo JSON válido'); }
            if (path === undefined) return;
            var current = body;
            String(path).split('.').forEach(function (p) { current = current == null ? undefined : current[p]; });
            if (current === undefined) fail('esperado o caminho "' + path + '" no JSON');
            if (arguments.length > 1) chai.expect(current).to.deep.equal(value);
          }
        },
        be: be
      }
    };
  }

  // ---- pm.test ----------------------------------------------------------
  function test(name, fn) {
    try {
      var result = fn();
      if (result && typeof result.then === 'function') {
        result.then(
          function () { host.test(String(name), 'passed', ''); },
          function (e) { host.test(String(name), 'failed', e && e.message ? e.message : String(e)); }
        );
      } else {
        host.test(String(name), 'passed', '');
      }
    } catch (e) {
      host.test(String(name), 'failed', e && e.message ? e.message : String(e));
    }
  }
  test.skip = function (name) { host.test(String(name), 'skipped', ''); };

  var local = scope('local');
  globalThis.pm = {
    environment: scope('environment'),
    collectionVariables: scope('collection'),
    globals: scope('global'),
    variables: {
      get: function (k) { return host.resolveVar(String(k)); },
      set: local.set,
      unset: local.unset,
      has: function (k) { return host.resolveVar(String(k)) !== undefined; },
      replaceIn: local.replaceIn,
      toObject: function () { return JSON.parse(host.resolvedObject()); }
    },
    request: request,
    response: response,
    info: { requestName: data.info.requestName, eventName: pre ? 'prerequest' : 'test', iteration: 0, iterationCount: 1 },
    iterationData: { get: function () { return undefined; }, has: function () { return false; }, toObject: function () { return {}; } },
    test: test,
    expect: chai.expect
  };

  // API antiga do Postman (scripts mais velhos ainda usam).
  var env = globalThis.pm.environment;
  var glob = globalThis.pm.globals;
  globalThis.postman = {
    setEnvironmentVariable: env.set,
    getEnvironmentVariable: env.get,
    clearEnvironmentVariable: env.unset,
    setGlobalVariable: glob.set,
    getGlobalVariable: glob.get,
    clearGlobalVariable: glob.unset
  };
  if (response) {
    globalThis.responseBody = response.text();
    globalThis.responseCode = { code: response.code, name: response.status };
    globalThis.responseTime = response.responseTime;
  }
  globalThis.tests = {};

  globalThis.__collect = function () {
    // A API antiga usa tests["nome"] = booleano.
    Object.keys(globalThis.tests).forEach(function (name) {
      host.test(name, globalThis.tests[name] ? 'passed' : 'failed', globalThis.tests[name] ? '' : 'tests["' + name + '"] é falso');
    });
    return JSON.stringify(req);
  };
})();
`;
