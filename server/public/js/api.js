async function request(method, path, body) {
  const opts = {
    method,
    headers: {}
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`/api${path}`, opts);
  const data = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : null;

  return { ok: res.ok, status: res.status, data };
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path)
};
