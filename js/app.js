// PT Web App — Core Application Logic

// ─── Sample Data ───────────────────────────────────────────────────────────
const sampleClients = [
  { id: 1, name: "Alex Johnson",  goal: "Weight Loss",    status: "active",   sessions: 24, since: "2024-03-01", weight: 185, targetWeight: 170 },
  { id: 2, name: "Sarah Williams",goal: "Muscle Gain",    status: "active",   sessions: 18, since: "2024-05-10", weight: 135, targetWeight: 145 },
  { id: 3, name: "Mike Thompson", goal: "Endurance",      status: "active",   sessions: 31, since: "2024-01-20", weight: 175, targetWeight: 165 },
  { id: 4, name: "Emma Davis",    goal: "General Fitness",status: "inactive", sessions: 8,  since: "2024-07-15", weight: 150, targetWeight: 145 },
  { id: 5, name: "Chris Martinez",goal: "Weight Loss",    status: "active",   sessions: 12, since: "2024-06-01", weight: 220, targetWeight: 195 },
];

const sampleWorkouts = [
  { id: 1, clientId: 1, clientName: "Alex Johnson",   date: "2024-11-14", type: "Strength",  duration: 60, exercises: ["Squats 3x10", "Deadlifts 3x8", "Bench Press 3x10"], notes: "Great form on squats" },
  { id: 2, clientId: 2, clientName: "Sarah Williams", date: "2024-11-14", type: "Hypertrophy",duration: 50, exercises: ["Pull-ups 4x8", "Rows 3x12", "Curls 3x15"], notes: "" },
  { id: 3, clientId: 3, clientName: "Mike Thompson",  date: "2024-11-13", type: "Cardio",    duration: 45, exercises: ["Run 5km", "Bike 10 mins", "Jump rope 5 mins"], notes: "PR on 5km run!" },
  { id: 4, clientId: 1, clientName: "Alex Johnson",   date: "2024-11-12", type: "Strength",  duration: 55, exercises: ["Squats 3x10", "Lunges 3x12", "RDL 3x10"], notes: "" },
  { id: 5, clientId: 5, clientName: "Chris Martinez", date: "2024-11-12", type: "HIIT",      duration: 40, exercises: ["Burpees 4x15", "KB Swings 4x20", "Box Jumps 3x12"], notes: "Pushed hard today" },
];

// ─── Utilities ─────────────────────────────────────────────────────────────
function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusBadge(status) {
  const cls = status === 'active' ? 'badge-green' : 'badge-gray';
  return `<span class="badge ${cls}">${status}</span>`;
}

// ─── Dashboard ─────────────────────────────────────────────────────────────
function renderDashboard() {
  const activeClients = sampleClients.filter(c => c.status === 'active').length;
  const thisWeekWorkouts = sampleWorkouts.filter(w => {
    const d = new Date(w.date);
    const now = new Date();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    return d >= weekAgo;
  }).length;

  return `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Active Clients</div>
        <div class="stat-value">${activeClients}</div>
        <div class="stat-change">↑ ${sampleClients.length} total</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Sessions This Week</div>
        <div class="stat-value">${thisWeekWorkouts}</div>
        <div class="stat-change">↑ logged</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Sessions</div>
        <div class="stat-value">${sampleWorkouts.length}</div>
        <div class="stat-change">all time</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Sessions / Client</div>
        <div class="stat-value">${Math.round(sampleClients.reduce((a,c)=>a+c.sessions,0)/sampleClients.length)}</div>
        <div class="stat-change">per client</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">Recent Workouts</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Client</th><th>Date</th><th>Type</th><th>Duration</th></tr></thead>
            <tbody>
              ${sampleWorkouts.slice(0,5).map(w => `
                <tr>
                  <td>${w.clientName}</td>
                  <td>${formatDate(w.date)}</td>
                  <td><span class="badge badge-blue">${w.type}</span></td>
                  <td>${w.duration} min</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Clients Overview</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Client</th><th>Goal</th><th>Status</th></tr></thead>
            <tbody>
              ${sampleClients.map(c => `
                <tr>
                  <td style="display:flex;align-items:center;gap:8px;">
                    <span class="avatar">${getInitials(c.name)}</span>${c.name}
                  </td>
                  <td>${c.goal}</td>
                  <td>${statusBadge(c.status)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ─── Clients ───────────────────────────────────────────────────────────────
function renderClients() {
  return `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Client</th><th>Goal</th><th>Sessions</th><th>Member Since</th><th>Status</th></tr></thead>
          <tbody>
            ${sampleClients.map(c => `
              <tr>
                <td style="display:flex;align-items:center;gap:10px;">
                  <span class="avatar">${getInitials(c.name)}</span>
                  <div>
                    <div style="font-weight:600">${c.name}</div>
                    <div style="font-size:12px;color:var(--text-muted)">Weight: ${c.weight} → ${c.targetWeight} lbs</div>
                  </div>
                </td>
                <td>${c.goal}</td>
                <td>${c.sessions}</td>
                <td>${formatDate(c.since)}</td>
                <td>${statusBadge(c.status)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ─── Workouts ──────────────────────────────────────────────────────────────
function renderWorkouts() {
  return `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Client</th><th>Date</th><th>Type</th><th>Duration</th><th>Exercises</th><th>Notes</th></tr></thead>
          <tbody>
            ${sampleWorkouts.map(w => `
              <tr>
                <td>${w.clientName}</td>
                <td>${formatDate(w.date)}</td>
                <td><span class="badge badge-blue">${w.type}</span></td>
                <td>${w.duration} min</td>
                <td style="font-size:12px;color:var(--text-muted)">${w.exercises.slice(0,2).join(', ')}${w.exercises.length>2?'…':''}</td>
                <td style="font-size:12px;color:var(--text-muted)">${w.notes || '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ─── Progress ──────────────────────────────────────────────────────────────
function renderProgress() {
  return `
    <div class="grid-2">
      ${sampleClients.filter(c=>c.status==='active').map(c => {
        const pct = Math.round(((c.weight - c.targetWeight) / (c.weight - c.targetWeight + 1)) * 100);
        const lost = c.weight > c.targetWeight ? c.weight - c.targetWeight : c.targetWeight - c.weight;
        return `
          <div class="card">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
              <span class="avatar">${getInitials(c.name)}</span>
              <div>
                <div style="font-weight:600">${c.name}</div>
                <div style="font-size:13px;color:var(--text-muted)">${c.goal}</div>
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;">
              <span>Current: <strong>${c.weight} lbs</strong></span>
              <span>Target: <strong>${c.targetWeight} lbs</strong></span>
            </div>
            <div style="background:var(--border);border-radius:4px;height:8px;margin-bottom:8px;">
              <div style="background:var(--accent);height:8px;border-radius:4px;width:${Math.min(80,lost*3)}%"></div>
            </div>
            <div style="font-size:12px;color:var(--text-muted)">${c.sessions} sessions completed</div>
          </div>`;
      }).join('')}
    </div>
  `;
}

// ─── Router ────────────────────────────────────────────────────────────────
const pages = {
  dashboard: { title: "Dashboard",   subtitle: "Welcome back! Here's your overview.", render: renderDashboard },
  clients:   { title: "Clients",     subtitle: "Manage your client roster.",           render: renderClients },
  workouts:  { title: "Workouts",    subtitle: "Track all training sessions.",          render: renderWorkouts },
  progress:  { title: "Progress",    subtitle: "Client progress and goal tracking.",    render: renderProgress },
};

let currentPage = 'dashboard';

function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  const p = pages[page];
  document.querySelector('.page-title').textContent = p.title;
  document.querySelector('.page-subtitle').textContent = p.subtitle;
  document.getElementById('page-content').innerHTML = p.render();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.page));
  });
  navigate('dashboard');
});
