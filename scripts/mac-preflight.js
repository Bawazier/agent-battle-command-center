#!/usr/bin/env node

/**
 * Mac Studio Pre-Flight Connectivity Check
 *
 * Validates that ABCC is ready to use a remote Ollama server (e.g., Mac Studio).
 * Checks: remote reachable, models pulled, API key set, local Ollama healthy, network latency.
 *
 * Usage:
 *   node scripts/mac-preflight.js
 *   REMOTE_OLLAMA_URL=http://mac-studio.local:11434 node scripts/mac-preflight.js
 */

const REMOTE_OLLAMA_URL = process.env.REMOTE_OLLAMA_URL || '';
const LOCAL_API_BASE = 'http://localhost:3001/api';
const LOCAL_AGENTS_BASE = 'http://localhost:8000';
const REMOTE_OLLAMA_MODEL_MAP = process.env.REMOTE_OLLAMA_MODEL_MAP || '';

const REQUIRED_MODELS = [
  'qwen2.5-coder:7b',
];

// Parse model map for additional required models on remote
function getRemoteRequiredModels() {
  if (!REMOTE_OLLAMA_MODEL_MAP) return [process.env.REMOTE_OLLAMA_MODEL || 'qwen2.5-coder:70b'];
  return REMOTE_OLLAMA_MODEL_MAP.split(',').map(entry => {
    const parts = entry.trim().split(':');
    return parts.slice(1).join(':'); // model name (may contain colons)
  }).filter(Boolean);
}

async function checkWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const start = Date.now();
    const response = await fetch(url, { signal: controller.signal });
    const latency = Date.now() - start;
    return { ok: response.ok, latency, status: response.status };
  } catch (error) {
    return { ok: false, latency: -1, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  MAC STUDIO PRE-FLIGHT CHECK');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let allOk = true;
  const results = [];

  // ── 1. Check environment variables ──────────────────────────────────────
  console.log('1. Environment Variables:');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    console.log('   ✅ ANTHROPIC_API_KEY: set');
    results.push({ check: 'ANTHROPIC_API_KEY', status: 'ok' });
  } else {
    console.log('   ⚠️  ANTHROPIC_API_KEY: not set (Claude features disabled)');
    results.push({ check: 'ANTHROPIC_API_KEY', status: 'warning' });
  }

  if (REMOTE_OLLAMA_URL) {
    console.log(`   ✅ REMOTE_OLLAMA_URL: ${REMOTE_OLLAMA_URL}`);
    results.push({ check: 'REMOTE_OLLAMA_URL', status: 'ok' });
  } else {
    console.log('   ⚠️  REMOTE_OLLAMA_URL: not set (2-tier fallback mode)');
    results.push({ check: 'REMOTE_OLLAMA_URL', status: 'warning' });
  }

  if (REMOTE_OLLAMA_MODEL_MAP) {
    console.log(`   ✅ REMOTE_OLLAMA_MODEL_MAP: ${REMOTE_OLLAMA_MODEL_MAP}`);
  }

  // ── 2. Check local Ollama ───────────────────────────────────────────────
  console.log('\n2. Local Ollama:');

  const localOllama = await checkWithTimeout('http://localhost:11434/api/tags');
  if (localOllama.ok) {
    console.log(`   ✅ Reachable (${localOllama.latency}ms)`);

    // Check local models
    try {
      const res = await fetch('http://localhost:11434/api/tags');
      const data = await res.json();
      const models = (data.models || []).map(m => m.name);
      for (const required of REQUIRED_MODELS) {
        const found = models.some(m => m.startsWith(required));
        if (found) {
          console.log(`   ✅ Model ${required}: available`);
        } else {
          console.log(`   ❌ Model ${required}: MISSING`);
          allOk = false;
        }
      }
    } catch {
      console.log('   ⚠️  Could not list models');
    }
  } else {
    console.log(`   ⚠️  Not reachable (may be running in Docker)`);
  }

  // ── 3. Check local ABCC services ───────────────────────────────────────
  console.log('\n3. Local ABCC Services:');

  const apiCheck = await checkWithTimeout(`${LOCAL_API_BASE}/agents`);
  if (apiCheck.ok) {
    console.log(`   ✅ API server: reachable (${apiCheck.latency}ms)`);
  } else {
    console.log(`   ❌ API server: NOT reachable`);
    allOk = false;
  }

  const agentsCheck = await checkWithTimeout(`${LOCAL_AGENTS_BASE}/health`);
  if (agentsCheck.ok) {
    console.log(`   ✅ Agents service: reachable (${agentsCheck.latency}ms)`);

    // Check remote_ollama flag in health
    try {
      const healthRes = await fetch(`${LOCAL_AGENTS_BASE}/health`);
      const health = await healthRes.json();
      if (health.remote_ollama !== undefined) {
        console.log(`   ${health.remote_ollama ? '✅' : '⚠️ '} Agents remote_ollama: ${health.remote_ollama}`);
      }
    } catch {}
  } else {
    console.log(`   ❌ Agents service: NOT reachable`);
    allOk = false;
  }

  // ── 4. Check remote Ollama ──────────────────────────────────────────────
  if (REMOTE_OLLAMA_URL) {
    console.log('\n4. Remote Ollama:');

    const remoteCheck = await checkWithTimeout(`${REMOTE_OLLAMA_URL}/api/tags`);
    if (remoteCheck.ok) {
      console.log(`   ✅ Reachable (${remoteCheck.latency}ms latency)`);

      if (remoteCheck.latency > 100) {
        console.log(`   ⚠️  High latency (${remoteCheck.latency}ms) — may slow down task execution`);
      }

      // Check remote models
      try {
        const res = await fetch(`${REMOTE_OLLAMA_URL}/api/tags`);
        const data = await res.json();
        const models = (data.models || []).map(m => m.name);
        const remoteRequired = getRemoteRequiredModels();

        for (const required of remoteRequired) {
          const found = models.some(m => m.startsWith(required));
          if (found) {
            console.log(`   ✅ Model ${required}: available`);
          } else {
            console.log(`   ❌ Model ${required}: MISSING — run: ollama pull ${required}`);
            allOk = false;
          }
        }

        console.log(`   📋 All remote models: ${models.join(', ')}`);
      } catch {
        console.log('   ⚠️  Could not list remote models');
      }
    } else {
      console.log(`   ❌ NOT reachable: ${remoteCheck.error || 'timeout'}`);
      console.log('   💡 Make sure Ollama is running on the Mac: OLLAMA_HOST=0.0.0.0 ollama serve');
      allOk = false;
    }

    // Latency test (3 pings)
    console.log('\n   Latency test (3 pings):');
    const latencies = [];
    for (let i = 0; i < 3; i++) {
      const ping = await checkWithTimeout(`${REMOTE_OLLAMA_URL}/api/tags`, 10000);
      if (ping.ok) {
        latencies.push(ping.latency);
        console.log(`     Ping ${i + 1}: ${ping.latency}ms`);
      } else {
        console.log(`     Ping ${i + 1}: FAILED`);
      }
    }
    if (latencies.length > 0) {
      const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
      console.log(`   Average latency: ${avg}ms ${avg < 50 ? '✅' : avg < 200 ? '⚠️' : '❌'}`);
    }
  } else {
    console.log('\n4. Remote Ollama: SKIPPED (REMOTE_OLLAMA_URL not set)');
  }

  // ── 5. Check resource pool ──────────────────────────────────────────────
  console.log('\n5. Resource Pool:');
  try {
    const poolRes = await fetch(`${LOCAL_API_BASE}/queue/resources`);
    if (poolRes.ok) {
      const pool = await poolRes.json();
      for (const resource of pool) {
        console.log(`   ${resource.type}: ${resource.activeSlots}/${resource.maxSlots} slots used`);
      }
    }
  } catch {
    console.log('   ⚠️  Could not check resource pool');
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  if (allOk) {
    console.log('  ✅ ALL CHECKS PASSED — Ready for remote Ollama!');
  } else {
    console.log('  ⚠️  SOME CHECKS FAILED — See details above');
  }
  console.log('═══════════════════════════════════════════════════════════════\n');

  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
