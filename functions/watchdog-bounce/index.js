import { GoogleAuth } from 'google-auth-library';

const RUN_V2 = 'https://run.googleapis.com/v2';

async function getAccessToken(scope = 'https://www.googleapis.com/auth/cloud-platform') {
  const auth = new GoogleAuth({ scopes: [scope] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token;
}

async function getService(projectId, region, service, token) {
  const url = `${RUN_V2}/projects/${projectId}/locations/${region}/services/${service}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET service failed: ${res.status}`);
  return await res.json();
}

function bumpEnv(serviceJson) {
  const envs = (serviceJson.template?.containers?.[0]?.env || []).map(e => ({ name: e.name, value: e.value }));
  const ts = String(Math.floor(Date.now() / 1000));
  const i = envs.findIndex(e => e.name === 'WATCHDOG_BOUNCE');
  if (i >= 0) envs[i].value = ts; else envs.push({ name: 'WATCHDOG_BOUNCE', value: ts });
  return envs;
}

async function patchServiceEnv(projectId, region, service, envs, token) {
  const url = `${RUN_V2}/projects/${projectId}/locations/${region}/services/${service}?updateMask=template.containers`;
  const body = {
    template: {
      containers: [ { env: envs } ]
    }
  };
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PATCH failed: ${res.status} ${txt}`);
  }
  return await res.json();
}

export async function handler(event, context) {
  const projectId = process.env.PROJECT_ID;
  const region = process.env.REGION || 'me-central1';
  const service = process.env.SERVICE || 'ordertech';
  try {
    const token = await getAccessToken();
    const svc = await getService(projectId, region, service, token);
    const envs = bumpEnv(svc);
    await patchServiceEnv(projectId, region, service, envs, token);
    console.log(JSON.stringify({ ok: true, action: 'bounce', service, region }));
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e?.message || String(e) }));
    throw e;
  }
}

