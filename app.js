// MedPrepAide All-in-One Engine (19 Subjects, Grand Tests, Rapid Fire, SRS & 20th Notebook)

let state = {
  currentView: 'home',
  curriculum: null,
  questionFilter: 'PYQ', // 'PYQ' | 'ADDITIONAL' | 'EXTREME' (page opens on PYQ, matching the highlighted toggle)
  activeSubjectCategory: 'ALL',
  activeSubject: null,
  activeUnit: null,
  activeQuestions: [],
  currentQIndex: 0,
  userAnswers: {},        // { [qId]: optionKey }
  markedForReview: {},    // { [qId]: boolean }
  elapsedSeconds: 0,
  timerInterval: null,
  
  // Modes:
  quizMode: 'UNIT',       // 'UNIT', 'RAPID_FIRE', 'GRAND_TEST', 'SRS'
  
  // Rapid Fire state:
  rfScope: 'GLOBAL',
  rfStreak: 0,
  rfBestStreak: 0,
  rfInstant: true,
  rfQuestions: [],
  rfAnsweredRecord: [],
  
  // Grand Test state:
  gtConfig: null,
  gtSecondsRemaining: 0,
  gtSubjectStats: {},

  // Theory & Notebook:
  selectedTheorySubjectId: null,
  selectedTheoryUnitId: null,
  selectedNotebookSubjectId: 'ALL',

  // Persistent User Data:
  userData: {
    practice: {},         // { [qId]: { r: 'C'|'W', d } } last practice result per question
    history: [],          // [{ mode, title, date, totalQ, correct, wrong, score, maxScore }]
    mistakes: {},         // { [qId]: { q, subjectId, userChoice, lastWrongDate } }
    srs: {},              // { [qId]: { subjectId, nextReviewDate, lastReviewedDate, interval, reps } }
    streak: 1,
    lastActiveDate: new Date().toISOString().split('T')[0]
  }
};

const SUBJECT_CATEGORIES = {
  'Pre-Clinical': ['ANATOMY', 'PHYSIOLOGY', 'BIOCHEMISTRY'],
  'Para-Clinical': ['PHARMACOLOGY', 'PATHOLOGY', 'MICROBIOLOGY', 'FMT'],
  'Clinical-Major': ['MEDICINE', 'SURGERY', 'OBGY'],
  'Clinical-Minor': ['PSM', 'OPHTHALMOLOGY', 'ENT', 'PEDIATRICS', 'ORTHOPEDICS', 'DERMATOLOGY', 'PSYCHIATRY', 'RADIOLOGY', 'ANESTHESIOLOGY']
};

// -------------------------------------------------------------
// INITIALIZATION
// -------------------------------------------------------------

// -------------------------------------------------------------
// LAZY PER-SUBJECT QUESTION LOADING (home page loads only the index)
// -------------------------------------------------------------
const DATA_VERSION = '20261118i';
const REPO_ISSUES_URL = 'https://github.com/MuhsinVC/neet-pg-app/issues/new';
const _subjectLoads = {};

window.__qdata = function (subjectId, byUnit) {
  const s = ((window.CURRICULUM_DATA || {}).subjects || []).find(x => x.subject_id === subjectId);
  if (!s) return;
  s.units.forEach(u => { u.questions = byUnit[u.unit_id] || []; });
  s._loaded = true;
};

function loadSubjectData(subjectId) {
  const s = state.curriculum.subjects.find(x => x.subject_id === subjectId);
  if (!s || s._loaded) return Promise.resolve();
  if (!_subjectLoads[subjectId]) {
    _subjectLoads[subjectId] = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = `data/q-${subjectId}.js?v=${DATA_VERSION}`;
      el.onload = () => resolve();
      el.onerror = () => { delete _subjectLoads[subjectId]; reject(new Error('load failed: ' + subjectId)); };
      document.head.appendChild(el);
    });
  }
  return _subjectLoads[subjectId];
}

async function ensureSubjects(ids) {
  const pending = ids.filter(id => {
    const s = state.curriculum.subjects.find(x => x.subject_id === id);
    return s && !s._loaded;
  });
  if (!pending.length) return true;
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.remove('hidden');
  try {
    await Promise.all(pending.map(loadSubjectData));
    return true;
  } catch (e) {
    alert(navigator.onLine === false ? 'You are offline and some of these questions are not saved on this device yet. Subjects are saved for offline use when you open them while online.' : 'Could not download the question data. Please check your internet connection and try again.');
    return false;
  } finally {
    if (overlay) overlay.classList.add('hidden');
  }
}

function allSubjectIds() { return state.curriculum.subjects.map(s => s.subject_id); }

function subjectIdOfUnit(unitId) {
  const s = state.curriculum.subjects.find(x => x.units.some(u => u.unit_id === unitId));
  return s ? s.subject_id : null;
}

// Question counts straight from the index (no need to download questions)
function unitCount(u) {
  const c = u.counts || { PYQ: 0, PRACTICE: 0, EXTREME: 0 };
  if (state.questionFilter === 'ADDITIONAL') return c.PRACTICE;
  if (state.questionFilter === 'EXTREME') return c.EXTREME;
  return c.PYQ;
}

function countDueSrs() {
  const now = Date.now();
  return Object.values(state.userData.srs).filter(i => now >= new Date(i.nextReviewDate).getTime()).length;
}

function dueSrsSubjectIds() {
  const now = Date.now();
  const ids = new Set();
  Object.values(state.userData.srs).forEach(i => {
    if (now >= new Date(i.nextReviewDate).getTime() && i.subjectId) ids.add(i.subjectId);
  });
  return [...ids].filter(id => state.curriculum.subjects.some(s => s.subject_id === id));
}

// -------------------------------------------------------------
// REPORT A QUESTION (opens a pre-filled GitHub Issue)
// -------------------------------------------------------------
function reportQuestion(qId) {
  const q = findQuestionById(qId)
    || state.activeQuestions.find(x => x.id === qId)
    || (state.userData.mistakes[qId] && state.userData.mistakes[qId].q);
  if (!q) return;
  const opts = Object.entries(q.options).map(([k, v]) => `${k}. ${v}`).join('\n');
  const body = [
    `**Question ID:** ${q.id}`,
    `**Subject / topic:** ${q.subject_name || ''} / ${q.topic || ''}`,
    `**Source label:** ${q.exam_source || ''}`,
    '',
    '**Question**',
    q.question,
    '',
    '**Options**',
    opts,
    '',
    `**Answer key in the app:** ${q.correct_option}`,
    '',
    '**What is wrong?** (wrong answer / unclear wording / typo / wrong image / other)',
    '',
  ].join('\n').slice(0, 2500);
  const url = `${REPO_ISSUES_URL}?title=${encodeURIComponent('Question report: ' + q.id)}&body=${encodeURIComponent(body)}`;
  window.open(url, '_blank', 'noopener');
}

function reportCurrentQuestion() {
  const q = state.activeQuestions[state.currentQIndex];
  if (q) reportQuestion(q.id);
}

function showExtremeNotice() {
  if (document.getElementById('extreme-notice')) return;
  const o = document.createElement('div');
  o.id = 'extreme-notice';
  o.setAttribute('role', 'dialog');
  o.setAttribute('aria-modal', 'true');
  o.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center;padding:16px;';
  o.innerHTML = '<div style="background:#fff;color:#0f172a;max-width:420px;width:100%;border-radius:16px;padding:20px;box-shadow:0 20px 40px rgba(0,0,0,.3);font-family:inherit;">'
    + '<div style="font-weight:800;font-size:16px;color:#b45309;margin-bottom:8px;">Extreme mode is a work in progress</div>'
    + '<p style="font-size:14px;line-height:1.5;margin:0 0 10px;">These questions are AI-generated and still being built and checked, so some may contain errors.</p>'
    + '<p style="font-size:14px;line-height:1.5;margin:0 0 16px;">Please verify answers and explanations against standard textbooks and current guidelines, and use <b>Report this question</b> if you spot a mistake.</p>'
    + '<button id="extreme-notice-ok" style="width:100%;background:#f59e0b;color:#0f172a;font-weight:800;border:none;border-radius:10px;padding:10px;font-size:14px;cursor:pointer;">I understand</button>'
    + '</div>';
  document.body.appendChild(o);
  const close = () => o.remove();
  document.getElementById('extreme-notice-ok').onclick = close;
  o.addEventListener('click', e => { if (e.target === o) close(); });
}

window.addEventListener('DOMContentLoaded', () => {
  loadUserData();
  if (window.CURRICULUM_DATA) {
    state.curriculum = window.CURRICULUM_DATA;
    updateFilterCounts();
    setQuestionFilter(state.questionFilter);
    renderSubjectsGrid();
    updateStatsHeader();
    lucide.createIcons();
  } else {
    alert("Could not load curriculum data. Please check data.js.");
  }
});

function loadUserData() {
  const saved = localStorage.getItem('MEDAIDE_MASTER_19_STATE_V3');
  if (saved) {
    try {
      state.userData = JSON.parse(saved);
      ['practice', 'mistakes', 'srs', 'why'].forEach(k => { if (!state.userData[k] || typeof state.userData[k] !== 'object') state.userData[k] = {}; });
      if (!Array.isArray(state.userData.history)) state.userData.history = [];
      const today = new Date().toISOString().split('T')[0];
      if (state.userData.lastActiveDate !== today) {
        state.userData.lastActiveDate = today;
        saveUserData();
      }
    } catch (e) {
      console.error("Error loading user data", e);
    }
  }
}

function saveUserData() {
  localStorage.setItem('MEDAIDE_MASTER_19_STATE_V3', JSON.stringify(state.userData));
  updateStatsHeader();
}

function updateStatsHeader() {
  if (typeof dtRefreshLight === 'function') dtRefreshLight();
  const streakText = `${state.userData.streak || 1} d`;
  const statStreak = document.getElementById('stat-streak');
  if (statStreak) statStreak.textContent = streakText;

  const dueList = { length: countDueSrs() };
  const statDue = document.getElementById('stat-due');
  if (statDue) statDue.textContent = dueList.length;
  
  const badgeDue = document.getElementById('badge-due');
  if (badgeDue) {
    if (dueList.length > 0) {
      badgeDue.textContent = dueList.length;
      badgeDue.classList.remove('hidden');
    } else {
      badgeDue.classList.add('hidden');
    }
  }

  // Update floating FAB badge & popover items
  const fabDueBadge = document.getElementById('fab-due-badge');
  const fabDueCount = document.getElementById('fab-due-count');
  const fabStreakCount = document.getElementById('fab-streak-count');

  if (fabDueBadge) {
    if (dueList.length > 0) {
      fabDueBadge.textContent = dueList.length;
      fabDueBadge.classList.remove('hidden');
    } else {
      fabDueBadge.classList.add('hidden');
    }
  }
  if (fabDueCount) fabDueCount.textContent = dueList.length;
  if (fabStreakCount) fabStreakCount.textContent = `${state.userData.streak || 1} Day Streak`;
}

// -------------------------------------------------------------
// QUESTION FILTER TOGGLE (1. PYQ ONLY, 2. ADDITIONAL, 3. EXTREME)
// -------------------------------------------------------------
function updateFilterCounts() {
  if (!state.curriculum) return;
  let totalAdditional = 0;
  let totalPyq = 0;
  let totalExtreme = 0;

  state.curriculum.subjects.forEach(s => {
    s.units.forEach(u => {
      const c = u.counts || { PYQ: 0, PRACTICE: 0, EXTREME: 0 };
      totalExtreme += c.EXTREME;
      totalAdditional += c.PRACTICE;
      totalPyq += c.PYQ;
    });
  });

  const bAdd = document.getElementById('badge-count-additional');
  const bPyq = document.getElementById('badge-count-pyq');
  const bExt = document.getElementById('badge-count-extreme');
  if (bAdd) bAdd.textContent = totalAdditional.toLocaleString();
  if (bPyq) bPyq.textContent = totalPyq.toLocaleString();
  if (bExt) bExt.textContent = totalExtreme.toLocaleString();
}

function setQuestionFilter(filterType) {
  state.questionFilter = filterType;
  const btnPyq = document.getElementById('toggle-filter-pyq');
  const btnAdd = document.getElementById('toggle-filter-additional');
  const btnExt = document.getElementById('toggle-filter-extreme');

  const inactiveClass = "px-2 sm:px-3 py-1 rounded-lg transition text-slate-500 hover:text-slate-800 flex items-center space-x-1";
  const activeClass = "px-2 sm:px-3 py-1 rounded-lg transition bg-white shadow-sm text-brand-700 font-bold flex items-center space-x-1";
  const activeExtClass = "px-2 sm:px-3 py-1 rounded-lg transition bg-amber-500 shadow-sm text-slate-950 font-black flex items-center space-x-1";

  if (btnPyq) btnPyq.className = filterType === 'PYQ' ? activeClass : inactiveClass;
  if (btnAdd) btnAdd.className = filterType === 'ADDITIONAL' ? activeClass : inactiveClass;
  if (btnExt) btnExt.className = filterType === 'EXTREME' ? activeExtClass : inactiveClass;
  if (filterType === 'EXTREME') showExtremeNotice();

  // Refresh current view
  if (state.currentView === 'home') renderSubjectsGrid();
  if (state.currentView === 'subject') renderSubjectUnits();
  if (state.currentView === 'theory') renderTheoryVault();
}

function getFilteredQuestions(questions) {
  // Modes are mutually exclusive: exactly one question type per toggle position.
  const want = state.questionFilter === 'ADDITIONAL' ? 'PRACTICE' : state.questionFilter === 'EXTREME' ? 'EXTREME' : 'PYQ';
  return questions.filter(q => q.question_type === want);
}

// -------------------------------------------------------------
// VIEW SWITCHING
// -------------------------------------------------------------
function switchView(viewName) {
  state.currentView = viewName;
  const views = ['home', 'subject', 'grand-test', 'rapid-fire', 'theory', 'quiz', 'post-test', 'srs', 'notebook', 'strengths', 'daily'];
  
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.add('hidden');
    const tab = document.getElementById(`tab-${v}`);
    if (tab) {
      tab.classList.remove('active-tab');
      tab.classList.add('text-slate-500');
    }
  });

  const activeEl = document.getElementById(`view-${viewName}`);
  if (activeEl) {
    activeEl.classList.remove('hidden');
    activeEl.classList.add('animate-fade-in');
  }

  const activeTab = document.getElementById(`tab-${viewName}`);
  if (activeTab) {
    activeTab.classList.add('active-tab');
    activeTab.classList.remove('text-slate-500');
  }

  if (viewName === 'home') renderSubjectsGrid();
  if (viewName === 'subject') renderSubjectUnits();
  if (viewName === 'theory') renderTheoryVault();
  if (viewName === 'srs') ensureSubjects(dueSrsSubjectIds()).then(renderSrsView);
  if (viewName === 'notebook') renderNotebookView();
  if (viewName === 'strengths') { renderStrengthsView(); mpRender(); }
  if (viewName === 'daily') dtRenderLanding();

  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => lucide.createIcons(), 50);
}

function goToHome() {
  state.activeSubject = null;
  switchView('home');
}

// -------------------------------------------------------------
// HOMEPAGE: 19 SUBJECTS GRID & CATEGORIES
// -------------------------------------------------------------
function filterSubjectCategory(cat) {
  state.activeSubjectCategory = cat;
  document.querySelectorAll('#subject-category-pills .cat-pill').forEach(btn => {
    if (btn.getAttribute('data-cat') === cat) {
      btn.className = "cat-pill active-cat px-3 py-1 rounded-lg text-xs font-bold bg-brand-600 text-white shadow-sm border border-brand-600 transition";
    } else {
      btn.className = "cat-pill px-3 py-1 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-100 transition";
    }
  });
  renderSubjectsGrid();
}

function renderSubjectsGrid() {
  const container = document.getElementById('subjects-grid');
  if (!container || !state.curriculum) return;
  container.innerHTML = '';

  let list = state.curriculum.subjects;
  if (state.activeSubjectCategory !== 'ALL') {
    const allowed = SUBJECT_CATEGORIES[state.activeSubjectCategory] || [];
    list = list.filter(s => allowed.includes(s.subject_id));
  }

  list.forEach(subj => {
    const card = document.createElement('div');
    card.className = "bg-white border border-slate-200 hover:border-brand-500 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-md transition duration-200 flex flex-col justify-between cursor-pointer group";
    card.onclick = () => openSubject(subj.subject_id);

    // Calculate question count respecting active toggle
    let qCount = 0;
    subj.units.forEach(u => {
      qCount += unitCount(u);
    });

    const isPharm = subj.subject_id === 'PHARMACOLOGY';
    const isMed = subj.subject_id === 'MEDICINE';
    const badgeColor = isPharm ? 'bg-indigo-50 text-indigo-700' : isMed ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700';

    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-2.5">
          <span class="${badgeColor} text-[11px] font-bold px-2 py-0.5 rounded-md">${subj.badge}</span>
          <span class="text-xs font-bold text-slate-500 flex items-center space-x-1">
            <i data-lucide="help-circle" class="w-3.5 h-3.5 text-slate-400"></i>
            <span>${qCount} Qs</span>
          </span>
        </div>
        <div class="flex items-center space-x-2.5 mb-2">
          <div class="w-9 h-9 rounded-xl bg-slate-100 group-hover:bg-brand-50 transition flex items-center justify-center font-bold text-slate-700 group-hover:text-brand-600">
            <i data-lucide="${subj.icon || 'book'}" class="w-4 h-4"></i>
          </div>
          <h4 class="text-sm sm:text-base font-bold text-slate-900 tracking-tight group-hover:text-brand-600 transition">${subj.name}</h4>
        </div>
        <p class="text-xs text-slate-500 leading-relaxed mb-3 line-clamp-2">${subj.description}</p>
      </div>

      <div class="pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
        <span class="text-[11px] text-slate-400 font-medium">
          ${subj.units.length} Units
        </span>
        <span class="font-bold text-brand-600 flex items-center space-x-1 group-hover:translate-x-0.5 transition">
          <span>Open</span>
          <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
        </span>
      </div>
    `;
    container.appendChild(card);
  });

  lucide.createIcons();
}

async function openSubject(subjectId) {
  const subj = state.curriculum.subjects.find(s => s.subject_id === subjectId);
  if (!subj) return;
  if (!(await ensureSubjects([subjectId]))) return;

  state.activeSubject = subj;
  document.getElementById('subject-breadcrumb-name').textContent = subj.name;
  document.getElementById('subject-page-title').textContent = subj.name;
  document.getElementById('subject-page-badge').textContent = subj.badge;
  document.getElementById('subject-page-desc').textContent = subj.description;

  switchView('subject');
}

// -------------------------------------------------------------
// SUBJECT SUBSECTION: CLUSTERED UNITS
// -------------------------------------------------------------
function renderSubjectUnits() {
  const container = document.getElementById('subject-units-grid');
  if (!container || !state.activeSubject) return;
  container.innerHTML = '';

  state.activeSubject.units.forEach(unit => {
    const qList = getFilteredQuestions(unit.questions);
    const totalQ = qList.length;

    let answeredCorrect = 0, answeredWrong = 0;
    const pmap = state.userData.practice || {};
    qList.forEach(q => { const p = pmap[q.id]; if (p && p.r === 'C') answeredCorrect++; else if (p && p.r === 'W') answeredWrong++; });

    const masteryPct = totalQ > 0 ? Math.min(100, Math.round((answeredCorrect / totalQ) * 100)) : 0;

    const card = document.createElement('div');
    card.className = "bg-white border border-slate-200 hover:border-brand-400 rounded-2xl p-5 shadow-sm hover:shadow-md transition duration-200 flex flex-col justify-between";
    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-2.5">
          <span class="bg-indigo-50 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded-md">Unit ${unit.unit_number}</span>
          <span class="text-xs font-semibold text-slate-500">
            ${totalQ} Questions
          </span>
        </div>
        <h4 class="text-base font-bold text-slate-900 tracking-tight mb-1.5">${unit.title}</h4>
        <p class="text-xs text-slate-500 line-clamp-2 mb-3.5">${unit.quick_theory.summary}</p>
        
        <!-- Mastery bar -->
        <div class="space-y-1 mb-4">
          <div class="flex justify-between text-[11px] font-semibold text-slate-600">
            <span>Practice progress</span>
            <span>${answeredCorrect} correct &middot; ${answeredWrong} wrong &middot; ${masteryPct}%</span>
          </div>
          <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div class="bg-gradient-to-r from-brand-600 to-indigo-500 h-1.5 rounded-full" style="width: ${masteryPct}%"></div>
          </div>
        </div>
      </div>

      <div class="pt-3 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <span class="text-[11px] text-slate-400 font-medium">${(unit.key_topics || unit.topics || []).length} Key Topics</span>
        <div class="flex items-center space-x-1.5">
          <button onclick="openUnitTheory('${state.activeSubject.subject_id}', '${unit.unit_id}')" class="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-xs font-bold transition flex items-center space-x-1 shadow-sm">
            <i data-lucide="zap" class="w-3.5 h-3.5 text-amber-500 fill-amber-500"></i>
            <span>Theory</span>
          </button>
          <button onclick="launchRapidFire('UNIT', '${unit.unit_id}')" class="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-xs font-bold transition flex items-center space-x-1 shadow-sm" title="Rapid Fire this unit">
            <i data-lucide="zap" class="w-3.5 h-3.5 fill-slate-950"></i>
            <span>Rapid</span>
          </button>
          <button onclick="startUnitQuiz('${unit.unit_id}')" class="px-3.5 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1 shadow-sm">
            <span>Practice</span>
            <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  lucide.createIcons();
}

function openSubjectTheory() {
  if (!state.activeSubject) return;
  state.selectedTheorySubjectId = state.activeSubject.subject_id;
  state.selectedTheoryUnitId = null;
  switchView('theory');
}

function openUnitTheory(subjectId, unitId) {
  state.selectedTheorySubjectId = subjectId;
  state.selectedTheoryUnitId = unitId;
  switchView('theory');
}

function startSubjectRapidFire() {
  if (!state.activeSubject) return;
  launchRapidFire('SUBJECT', state.activeSubject.subject_id);
}

function returnToActiveSubject() {
  if (state.activeSubject) {
    switchView('subject');
  } else {
    goToHome();
  }
}

// -------------------------------------------------------------
// RAPID FIRE DRILL ENGINE
// -------------------------------------------------------------
function startRapidFireModal() {
  switchView('rapid-fire');
}

async function launchRapidFire(scope, targetId) {
  let ids = allSubjectIds();
  if (scope === 'PRE_PARA') ids = [...SUBJECT_CATEGORIES['Pre-Clinical'], ...SUBJECT_CATEGORIES['Para-Clinical']];
  else if (scope === 'CLINICAL') ids = [...SUBJECT_CATEGORIES['Clinical-Major'], ...SUBJECT_CATEGORIES['Clinical-Minor']];
  else if (scope === 'SUBJECT') ids = [targetId];
  else if (scope === 'UNIT') { const sid = subjectIdOfUnit(targetId); ids = sid ? [sid] : []; }
  if (!(await ensureSubjects(ids))) return;
  launchRapidFireNow(scope, targetId);
}

function launchRapidFireNow(scope, targetId) {
  state.quizMode = 'RAPID_FIRE';
  state.dtCtx = scope === 'LIST' ? (state.rfListCtx || null) : null;
  state.rfScope = scope;
  state.rfStreak = 0;
  state.rfAnsweredRecord = [];
  state.userAnswers = {};
  state.elapsedSeconds = 0;

  // Gather questions based on scope
  let pool = [];
  if (scope === 'GLOBAL') {
    state.curriculum.subjects.forEach(s => {
      s.units.forEach(u => pool.push(...u.questions));
    });
  } else if (scope === 'PRE_PARA') {
    const ids = [...SUBJECT_CATEGORIES['Pre-Clinical'], ...SUBJECT_CATEGORIES['Para-Clinical']];
    state.curriculum.subjects.filter(s => ids.includes(s.subject_id)).forEach(s => {
      s.units.forEach(u => pool.push(...u.questions));
    });
  } else if (scope === 'CLINICAL') {
    const ids = [...SUBJECT_CATEGORIES['Clinical-Major'], ...SUBJECT_CATEGORIES['Clinical-Minor']];
    state.curriculum.subjects.filter(s => ids.includes(s.subject_id)).forEach(s => {
      s.units.forEach(u => pool.push(...u.questions));
    });
  } else if (scope === 'SUBJECT') {
    const s = state.curriculum.subjects.find(x => x.subject_id === targetId);
    if (s) s.units.forEach(u => pool.push(...u.questions));
  } else if (scope === 'LIST') {
    pool = (state.rfList || []).slice();
  } else if (scope === 'UNIT') {
    for (const s of state.curriculum.subjects) {
      const u = s.units.find(x => x.unit_id === targetId);
      if (u) {
        pool.push(...u.questions);
        break;
      }
    }
  }

  // Filter if PYQ toggle is on (prepared lists are already chosen)
  if (scope !== 'LIST') pool = getFilteredQuestions(pool);

  if (pool.length === 0) {
    alert("No questions found for the selected filter and scope.");
    return;
  }

  // Shuffle pool thoroughly (prepared lists keep their order)
  state.activeQuestions = scope === 'LIST' ? pool : shuffleArray([...pool]);
  state.currentQIndex = 0;

  // Setup UI elements for Rapid Fire
  document.getElementById('rf-stats-bar').classList.remove('hidden');
  document.getElementById('rf-streak').textContent = '0';
  document.getElementById('rf-accuracy').textContent = '100%';
  document.getElementById('btn-mark-review').classList.add('hidden');
  document.getElementById('btn-clear-choice').classList.add('hidden');
  document.getElementById('btn-open-palette').classList.add('hidden');
  document.getElementById('gt-palette-column').classList.add('hidden');
  document.getElementById('quiz-left-column').className = "lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 shadow-sm space-y-5";

  document.getElementById('quiz-unit-title').textContent = scope === 'LIST' ? (state.rfTitle || 'Drill') : `⚡ Rapid Fire Drill (${scope})`;
  document.getElementById('quiz-unit-subtitle').textContent = scope === 'LIST' ? (state.rfSubtitle || `${pool.length} questions • End anytime`) : `Infinite Random Questions • End anytime`;

  startTimer();
  switchView('quiz');
  renderCurrentQuestion();
}

function toggleRfInstant() {
  state.rfInstant = document.getElementById('rf-instant-toggle').checked;
}

function finishRapidFire() {
  stopTimer();
  if (state.rfAnsweredRecord.length === 0) {
    switchView(state.dtCtx && state.dtCtx.kind ? 'daily' : 'rapid-fire');
    return;
  }

  // Calculate results
  const total = state.rfAnsweredRecord.length;
  const correct = state.rfAnsweredRecord.filter(r => r.isCorrect).length;
  const wrong = total - correct;
  const accuracy = Math.round((correct / total) * 100);

  // Auto-record history
  state.userData.history.push({
    mode: 'RAPID_FIRE',
    title: state.rfScope === 'LIST' ? (state.rfTitle || 'Drill') : `Rapid Fire (${state.rfScope})`,
    date: new Date().toISOString(),
    totalQ: total,
    correct: correct,
    wrong: wrong,
    score: correct,
    maxScore: total,
    elapsedSeconds: state.elapsedSeconds
  });
  saveUserData();

  // Populate Post-Test view
  document.getElementById('post-title').textContent = "Rapid Fire Drill Complete!";
  document.getElementById('post-badge').textContent = `${total} Questions Attempted`;
  document.getElementById('score-percent').textContent = `${accuracy}%`;
  document.getElementById('score-percent-label').textContent = "Accuracy";
  document.getElementById('post-summary-text').textContent = 
    `You solved ${correct} correct out of ${total} attempted in ${formatTime(state.elapsedSeconds)} (avg ${(state.elapsedSeconds / total).toFixed(1)}s/Q). All incorrect answers are logged in your 20th Notebook.`;

  document.getElementById('review-correct-count').textContent = `${correct} Correct`;
  document.getElementById('review-wrong-count').textContent = `${wrong} Wrong`;
  document.getElementById('gt-breakdown-card').classList.add('hidden');
  document.getElementById('post-theory-section').classList.add('hidden');

  renderReviewList(state.rfAnsweredRecord.map(r => r.question));
  switchView('post-test');
}

// -------------------------------------------------------------
// GRAND TEST (GT) SIMULATION ENGINE
// -------------------------------------------------------------
async function startGrandTest(examType) {
  if (!(await ensureSubjects(allSubjectIds()))) return;
  startGrandTestNow(examType);
}

function startGrandTestNow(examType) {
  state.quizMode = 'GRAND_TEST';
  state.gtExamType = examType;
  state.gtTimes = {}; state._qShownId = null;
  state.dtCtx = null;
  state.userAnswers = {};
  state.markedForReview = {};
  state.elapsedSeconds = 0;

  const configs = {
    'NEET_PG_FULL': { name: 'NEET PG Full Grand Test', count: 200, durationMins: 210, pos: 4, neg: 1, maxMarks: 800 },
    'NEET_PG_MINI': { name: 'NEET PG Mini-GT', count: 50, durationMins: 50, pos: 4, neg: 1, maxMarks: 200 },
    'INICET_FULL': { name: 'INI-CET Full Grand Test', count: 200, durationMins: 180, pos: 1, neg: 0.33, maxMarks: 200 },
    'INICET_MINI': { name: 'INI-CET Mini-GT', count: 50, durationMins: 45, pos: 1, neg: 0.33, maxMarks: 50 }
  };

  const cfg = examType === 'PRESET' ? state.gtPresetCfg : configs[examType];
  state.gtConfig = cfg;
  state.gtSecondsRemaining = cfg.durationMins * 60;

  // Build balanced exam paper across all 19 subjects
  let examPool = [];
  state.curriculum.subjects.forEach(s => {
    s.units.forEach(u => {
      u.questions.forEach(q => {
        examPool.push({ ...q, subject_id: s.subject_id, subject_name: s.name });
      });
    });
  });

  examPool = getFilteredQuestions(examPool);
  examPool = shuffleArray(examPool);
  if (examType === 'PRESET') examPool = (state.gtPresetList || []).slice();

  if (examPool.length < cfg.count) {
    // If PYQ toggle yields fewer than target, take all available
    state.activeQuestions = examPool;
  } else {
    state.activeQuestions = examPool.slice(0, cfg.count);
  }

  state.currentQIndex = 0;

  // Setup UI for Grand Test
  document.getElementById('rf-stats-bar').classList.add('hidden');
  document.getElementById('btn-mark-review').classList.remove('hidden');
  document.getElementById('btn-clear-choice').classList.remove('hidden');
  document.getElementById('btn-open-palette').classList.remove('hidden');
  document.getElementById('gt-palette-column').classList.remove('hidden');
  document.getElementById('quiz-left-column').className = "lg:col-span-3 bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 shadow-sm space-y-5";

  document.getElementById('quiz-unit-title').textContent = cfg.name;
  document.getElementById('quiz-unit-subtitle').textContent = `Target: ${state.activeQuestions.length} MCQs • +${cfg.pos} / -${cfg.neg}`;

  startCountdownTimer();
  switchView('quiz');
  setPaletteChrome('GT');
  renderPaletteGrid();
  renderCurrentQuestion();
}

function startCountdownTimer() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    state.gtSecondsRemaining--;
    state.elapsedSeconds++;

    if (state.gtSecondsRemaining <= 0) {
      clearInterval(state.timerInterval);
      alert("Time is up! Submitting your Grand Test automatically.");
      submitGrandTest();
      return;
    }

    const hours = Math.floor(state.gtSecondsRemaining / 3600);
    const mins = Math.floor((state.gtSecondsRemaining % 3600) / 60);
    const secs = state.gtSecondsRemaining % 60;

    const timerBox = document.getElementById('timer-box');
    const timerText = hours > 0 
      ? `${hours}h ${String(mins).padStart(2, '0')}m`
      : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    document.getElementById('quiz-timer').textContent = timerText;

    if (state.gtSecondsRemaining < 600) { // < 10 mins
      timerBox.className = "text-rose-700 bg-rose-100 font-bold px-2 sm:px-2.5 py-1 rounded-lg flex items-center space-x-1 animate-pulse";
    } else {
      timerBox.className = "text-slate-700 bg-slate-100 px-2 sm:px-2.5 py-1 rounded-lg flex items-center space-x-1";
    }
  }, 1000);
}

function practiceOf(qId) { return (state.userData.practice || {})[qId]; }
function practiceTileStyle(qId, mobile) {
  const p = practiceOf(qId);
  if (p && p.r === 'C') return "bg-emerald-600 text-white font-bold border border-emerald-700";
  if (p && p.r === 'W') return "bg-rose-600 text-white font-bold border border-rose-700";
  return "bg-slate-200 text-slate-600 border border-slate-300 hover:bg-slate-300";
}
function setPaletteChrome(mode) {
  const prac = mode === 'PRACTICE';
  const legend = document.getElementById('palette-legend');
  if (legend) legend.innerHTML = prac
    ? '<span class="flex items-center space-x-1"><span class="w-2.5 h-2.5 rounded-full bg-emerald-600"></span> <span>Correct</span></span>'
      + '<span class="flex items-center space-x-1"><span class="w-2.5 h-2.5 rounded-full bg-rose-600"></span> <span>Wrong last time</span></span>'
      + '<span class="flex items-center space-x-1"><span class="w-2.5 h-2.5 rounded-full bg-slate-300"></span> <span>Unattempted</span></span>'
    : '<span class="flex items-center space-x-1"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> <span>Answered</span></span>'
      + '<span class="flex items-center space-x-1"><span class="w-2.5 h-2.5 rounded-full bg-purple-500"></span> <span>Review</span></span>'
      + '<span class="flex items-center space-x-1"><span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span> <span>Ans & Rev</span></span>'
      + '<span class="flex items-center space-x-1"><span class="w-2.5 h-2.5 rounded-full bg-slate-200"></span> <span>Unvisited</span></span>';
  const t = document.getElementById('palette-title'); if (t) t.textContent = prac ? 'Practice Progress' : 'Question Palette';
  const mt = document.getElementById('mobile-palette-title'); if (mt) mt.textContent = prac ? 'Practice Progress' : 'Question Palette (1 to 200)';
  const sb = document.getElementById('palette-submit-btn');
  if (sb) { sb.textContent = prac ? 'Finish practice' : 'Submit Grand Test'; sb.onclick = prac ? () => submitQuiz() : () => submitGrandTestConfirm(); }
  const cb = document.getElementById('btn-clear-choice'); if (cb) cb.textContent = prac ? 'Try again' : 'Clear';
}

function togglePaletteModal() {
  const modal = document.getElementById('palette-modal');
  modal.classList.toggle('hidden');
  if (!modal.classList.contains('hidden')) {
    renderMobilePaletteGrid();
  }
}

function renderPaletteGrid() {
  const container = document.getElementById('gt-palette-grid');
  if (!container) return;
  container.innerHTML = '';

  let answeredCount = 0;

  state.activeQuestions.forEach((q, idx) => {
    const btn = document.createElement('button');
    const isAnswered = !!state.userAnswers[q.id];
    const isMarked = !!state.markedForReview[q.id];
    const isCurrent = state.currentQIndex === idx;

    if (state.quizMode === 'PRACTICE' ? !!practiceOf(q.id) : isAnswered) answeredCount++;

    let style = "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200";
    if (isAnswered && !isMarked) style = "bg-emerald-600 text-white font-bold border border-emerald-700";
    if (isMarked && !isAnswered) style = "bg-purple-600 text-white font-bold border border-purple-700";
    if (isAnswered && isMarked) style = "bg-amber-500 text-white font-bold border border-amber-600";
    if (state.quizMode === 'PRACTICE') style = practiceTileStyle(q.id);
    if (isCurrent) style += " ring-2 ring-brand-500 ring-offset-1";

    btn.className = `w-full h-8 text-[11px] rounded-lg transition ${style}`;
    btn.textContent = idx + 1;
    btn.onclick = () => jumpToQuestion(idx);
    container.appendChild(btn);
  });

  document.getElementById('palette-status-count').textContent = `${answeredCount} / ${state.activeQuestions.length}`;
}

function renderMobilePaletteGrid() {
  const container = document.getElementById('mobile-palette-grid');
  if (!container) return;
  container.innerHTML = '';

  state.activeQuestions.forEach((q, idx) => {
    const btn = document.createElement('button');
    const isAnswered = !!state.userAnswers[q.id];
    const isMarked = !!state.markedForReview[q.id];
    const isCurrent = state.currentQIndex === idx;

    let style = "bg-slate-100 text-slate-700 border border-slate-200";
    if (isAnswered && !isMarked) style = "bg-emerald-600 text-white font-bold";
    if (isMarked && !isAnswered) style = "bg-purple-600 text-white font-bold";
    if (isAnswered && isMarked) style = "bg-amber-500 text-white font-bold";
    if (state.quizMode === 'PRACTICE') style = practiceTileStyle(q.id);
    if (isCurrent) style += " ring-2 ring-brand-500";

    btn.className = `w-full h-9 text-xs rounded-xl transition ${style}`;
    btn.textContent = idx + 1;
    btn.onclick = () => {
      togglePaletteModal();
      jumpToQuestion(idx);
    };
    container.appendChild(btn);
  });
}

function jumpToQuestion(idx) {
  state.currentQIndex = idx;
  renderCurrentQuestion();
  renderPaletteGrid();
}

function toggleMarkForReview() {
  const q = state.activeQuestions[state.currentQIndex];
  if (!q) return;
  state.markedForReview[q.id] = !state.markedForReview[q.id];
  renderCurrentQuestion();
  renderPaletteGrid();
}

function clearOptionChoice() {
  const q = state.activeQuestions[state.currentQIndex];
  if (!q) return;
  delete state.userAnswers[q.id];
  renderCurrentQuestion();
  renderPaletteGrid();
}

function submitGrandTestConfirm() {
  const total = state.activeQuestions.length;
  const answered = Object.keys(state.userAnswers).length;
  const unvisited = total - answered;
  const marked = Object.values(state.markedForReview).filter(Boolean).length;

  if (confirm(`Grand Test Submission:\n\n• Answered: ${answered} / ${total}\n• Marked for Review: ${marked}\n• Unvisited / Unanswered: ${unvisited}\n\nAre you sure you want to finish and view your scorecard?`)) {
    submitGrandTest();
  }
}

function submitGrandTest() {
  stopTimer();
  gtAddTime();
  const cfg = state.gtConfig;
  const total = state.activeQuestions.length;
  let correct = 0;
  let incorrect = 0;
  let unattempted = 0;

  // Track subject-wise performance across all 19 subjects
  const subjectMap = {};
  state.curriculum.subjects.forEach(s => {
    subjectMap[s.subject_id] = { name: s.name, total: 0, attempted: 0, correct: 0, incorrect: 0, score: 0 };
  });

  state.activeQuestions.forEach(q => {
    const sId = q.subject_id || (state.activeSubject ? state.activeSubject.subject_id : 'GENERAL');
    if (!subjectMap[sId]) {
      subjectMap[sId] = { name: sId, total: 0, attempted: 0, correct: 0, incorrect: 0, score: 0 };
    }
    subjectMap[sId].total++;

    const chosen = state.userAnswers[q.id];
    if (chosen) pgLog(q, chosen, chosen === q.correct_option, 'GRAND_TEST');
    if (!chosen) {
      unattempted++;
    } else if (chosen === q.correct_option) {
      correct++;
      subjectMap[sId].attempted++;
      subjectMap[sId].correct++;
      subjectMap[sId].score += cfg.pos;
    } else {
      incorrect++;
      subjectMap[sId].attempted++;
      subjectMap[sId].incorrect++;
      subjectMap[sId].score -= cfg.neg;

      // Register mistakes into 20th Notebook and (if switched on in Settings) the Spaced Review queue
      recordMistake(q, sId, chosen);
      scheduleSrsReview(q.id, sId, false, srsSourceNow());
    }
  });

  const totalScore = (correct * cfg.pos) - (incorrect * cfg.neg);
  const maxPossible = total * cfg.pos;
  const pct = Math.max(0, Math.round((totalScore / maxPossible) * 100));

  // Save to history
  state.userData.history.push({
    mode: 'GRAND_TEST',
    title: cfg.name,
    date: new Date().toISOString(),
    totalQ: total,
    correct: correct,
    wrong: incorrect,
    unattempted: unattempted,
    score: totalScore,
    maxScore: maxPossible,
    elapsedSeconds: state.elapsedSeconds
  });
  saveUserData();

  // Populate Scorecard
  document.getElementById('post-title').textContent = `${cfg.name} Scorecard`;
  document.getElementById('post-badge').textContent = `Score: ${totalScore} / ${maxPossible}`;
  document.getElementById('score-percent').textContent = `${totalScore}`;
  document.getElementById('score-percent-label').textContent = "Marks";
  document.getElementById('post-summary-text').textContent = 
    `Attempted: ${correct + incorrect} / ${total} • Correct: ${correct} (+${correct * cfg.pos}) • Incorrect: ${incorrect} (-${incorrect * cfg.neg}) • Time: ${formatTime(state.elapsedSeconds)}. All mistakes have been saved to your 20th Notebook!`;

  document.getElementById('review-correct-count').textContent = `${correct} Correct`;
  document.getElementById('review-wrong-count').textContent = `${incorrect} Wrong`;

  // Render 19 Subject Breakdown table
  renderGrandTestBreakdown(subjectMap);
  document.getElementById('gt-breakdown-card').classList.remove('hidden');
  document.getElementById('post-theory-section').classList.add('hidden');

  renderReviewList(state.activeQuestions);
  switchView('post-test');
}

function renderGrandTestBreakdown(subjectMap) {
  const tbody = document.getElementById('gt-subject-breakdown-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  Object.values(subjectMap).filter(s => s.total > 0).forEach(s => {
    const tr = document.createElement('tr');
    const acc = s.attempted > 0 ? Math.round((s.correct / s.attempted) * 100) : 0;
    tr.className = "hover:bg-slate-50 transition";
    tr.innerHTML = `
      <td class="py-2.5 px-3 font-bold text-slate-900">${s.name}</td>
      <td class="py-2.5 px-3">${s.total}</td>
      <td class="py-2.5 px-3">${s.attempted}</td>
      <td class="py-2.5 px-3 font-semibold text-emerald-600">${s.correct}</td>
      <td class="py-2.5 px-3 font-semibold text-rose-600">${s.incorrect}</td>
      <td class="py-2.5 px-3 font-bold ${s.score >= 0 ? 'text-slate-900' : 'text-rose-600'}">${s.score}</td>
      <td class="py-2.5 px-3 font-semibold text-slate-700">${acc}%</td>
    `;
    tbody.appendChild(tr);
  });
}

// -------------------------------------------------------------
// STANDARD UNIT QUIZ FLOW
// -------------------------------------------------------------
async function startUnitQuiz(unitId) {
  const sid = subjectIdOfUnit(unitId);
  if (sid && !(await ensureSubjects([sid]))) return;
  startUnitQuizNow(unitId);
}

function startUnitQuizNow(unitId) {
  state.dtCtx = null;
  state.quizMode = 'PRACTICE';
  let unit = null;
  let subjFound = null;

  for (const s of state.curriculum.subjects) {
    const u = s.units.find(x => x.unit_id === unitId);
    if (u) {
      unit = u;
      subjFound = s;
      break;
    }
  }

  if (!unit) return;

  state.activeSubject = subjFound;
  state.activeUnit = unit;
  state.activeQuestions = getFilteredQuestions(unit.questions);
  state.currentQIndex = 0;
  state.userAnswers = {};
  state.elapsedSeconds = 0;

  if (state.activeQuestions.length === 0) {
    alert("No questions found in this unit under current filter.");
    return;
  }

  document.getElementById('rf-stats-bar').classList.add('hidden');
  document.getElementById('btn-mark-review').classList.add('hidden');
  document.getElementById('btn-clear-choice').classList.add('hidden');
  document.getElementById('btn-open-palette').classList.add('hidden');
  document.getElementById('gt-palette-column').classList.add('hidden');
  document.getElementById('quiz-left-column').className = "lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 shadow-sm space-y-5";

  document.getElementById('quiz-unit-title').textContent = `${subjFound.name} • Unit ${unit.unit_number}: ${unit.title}`;
  document.getElementById('quiz-unit-subtitle').textContent = `Practice • ${state.activeQuestions.length} Questions • progress is saved`;
  document.getElementById('btn-clear-choice').classList.remove('hidden');
  document.getElementById('btn-open-palette').classList.remove('hidden');
  document.getElementById('gt-palette-column').classList.remove('hidden');
  document.getElementById('quiz-left-column').className = "lg:col-span-3 bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 shadow-sm space-y-5";
  setPaletteChrome('PRACTICE');
  // resume at the first unattempted question, else the first one answered wrong last time
  {
    const pm = state.userData.practice || {};
    let idx = state.activeQuestions.findIndex(q => !pm[q.id]);
    if (idx < 0) idx = state.activeQuestions.findIndex(q => pm[q.id] && pm[q.id].r === 'W');
    state.currentQIndex = idx < 0 ? 0 : idx;
  }
  renderPaletteGrid();

  startTimer();
  switchView('quiz');
  renderCurrentQuestion();
}

function startTimer() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    state.elapsedSeconds++;
    document.getElementById('quiz-timer').textContent = formatTime(state.elapsedSeconds);
  }, 1000);
}

function stopTimer() {
  if (state.timerInterval) clearInterval(state.timerInterval);
}

function formatTime(totalSecs) {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// -------------------------------------------------------------
// IMAGE MODAL / LIGHTBOX
// -------------------------------------------------------------
function openActiveQuestionImage() {
  const q = state.activeQuestions[state.currentQIndex];
  if (q && q.image_url) {
    openImageModal(q.image_url, '');
  }
}

function openImageModal(src, caption) {
  const modal = document.getElementById('image-modal');
  const img = document.getElementById('image-modal-img');
  const cap = document.getElementById('image-modal-caption');
  if (modal && img) {
    img.src = src;
    if (cap) cap.textContent = caption || '';
    modal.classList.remove('hidden');
  }
}

function closeImageModal() {
  const modal = document.getElementById('image-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

// -------------------------------------------------------------
// QUESTION PRESENTATION & INTERACTION
// -------------------------------------------------------------
function renderCurrentQuestion() {
  const dtq = document.getElementById('dt-quiz-status'); if (dtq) dtq.classList.toggle('hidden', !(state.dtCtx && state.quizMode === 'RAPID_FIRE'));
  const q = state.activeQuestions[state.currentQIndex];
  if (!q) return;
  if (state.dtCtx && state.quizMode === 'RAPID_FIRE') dtSubtitle(q);
  if (state.quizMode === 'GRAND_TEST' && state.gtTimes && state._qShownId && state._qShownMode === 'GRAND_TEST' && state._qShownId !== q.id) gtAddTime();
  bmPaintCurrent(q);
  if (state._qShownId !== q.id || state._qShownMode !== state.quizMode) { state._qShownId = q.id; state._qShownMode = state.quizMode; state._qShownAt = Date.now(); }

  const total = state.activeQuestions.length;
  document.getElementById('quiz-counter').textContent = `Q ${state.currentQIndex + 1} of ${total}`;
  document.getElementById('quiz-source-badge').textContent = q.exam_source;
  document.getElementById('quiz-topic-tag').textContent = q.topic;
  document.getElementById('quiz-question-text').textContent = q.question;

  // Clinical & Diagnostic Image rendering
  const imgContainer = document.getElementById('quiz-image-container');
  const imgElem = document.getElementById('quiz-question-image');
  if (imgContainer && imgElem) {
    let credit = document.getElementById('quiz-image-credit');
    if (!credit) {
      credit = document.createElement('div');
      credit.id = 'quiz-image-credit';
      credit.className = 'text-[10px] text-slate-400 mt-1';
      imgContainer.appendChild(credit);
    }
    if (q.image_url) {
      imgElem.src = q.image_url;
      imgElem.alt = 'Question image';
      credit.textContent = '';
      if (q.image_credit) {
        const revealNow = (state.quizMode === 'PRACTICE' && state.userAnswers[q.id])
          || (state.quizMode === 'RAPID_FIRE' && state.rfInstant && state.userAnswers[q.id]);
        if (revealNow) credit.textContent = 'Image: ' + q.image_credit;
        else {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'underline hover:text-slate-600'; b.textContent = 'Show image source';
          b.onclick = () => { credit.textContent = 'Image: ' + q.image_credit; };
          credit.appendChild(b);
        }
      }
      imgContainer.classList.remove('hidden');
    } else {
      credit.textContent = '';
      imgContainer.classList.add('hidden');
    }
  }

  // Subject badge
  const subjName = q.subject_name || (state.activeSubject ? state.activeSubject.name : 'Medical');
  document.getElementById('quiz-subject-badge').textContent = subjName;

  const container = document.getElementById('quiz-options-container');
  container.innerHTML = '';

  const selectedOpt = state.userAnswers[q.id];
  const isRapidFire = state.quizMode === 'RAPID_FIRE';
  const instantBox = document.getElementById('rf-instant-feedback');
  instantBox.classList.add('hidden');

  Object.entries(q.options).forEach(([optKey, optVal]) => {
    const isSelected = selectedOpt === optKey;
    const btn = document.createElement('button');
    btn.className = `w-full text-left p-3.5 sm:p-4 rounded-xl border text-xs sm:text-sm font-medium transition duration-150 flex items-start space-x-3 ${
      isSelected 
        ? 'border-brand-600 bg-brand-50/70 text-brand-900 shadow-sm ring-1 ring-brand-500' 
        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700'
    }`;

    btn.onclick = () => selectOption(optKey);
    if (state.quizMode === 'PRACTICE' && selectedOpt) {
      const base = 'w-full text-left p-3.5 sm:p-4 rounded-xl border text-xs sm:text-sm font-medium transition duration-150 flex items-start space-x-3 ';
      if (optKey === q.correct_option) btn.className = base + 'border-emerald-500 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-400';
      else if (isSelected) btn.className = base + 'border-rose-500 bg-rose-50 text-rose-900 ring-1 ring-rose-400';
      else btn.className = base + 'border-slate-200 text-slate-400';
    }
    btn.innerHTML = `
      <span class="w-6 h-6 rounded-lg ${
        isSelected ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
      } flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
        ${optKey}
      </span>
      <span class="flex-1 leading-snug">${optVal}</span>
    `;
    container.appendChild(btn);
  });

  if (state.quizMode === 'PRACTICE') showPracticeFeedback(q, selectedOpt);

  // Rapid Fire Instant Reveal if already chosen
  if (isRapidFire && selectedOpt && state.rfInstant) {
    showRapidFireFeedback(q, selectedOpt);
  }

  // Update Navigation Buttons
  const btnPrev = document.getElementById('btn-prev-q');
  const btnNext = document.getElementById('btn-next-q');
  const btnSubmit = document.getElementById('btn-submit-q');
  const btnMark = document.getElementById('btn-mark-review');
  const btnMarkText = document.getElementById('btn-mark-text');

  if (state.quizMode === 'GRAND_TEST') {
    btnPrev.classList.remove('hidden');
    if (state.markedForReview[q.id]) {
      btnMark.className = "px-3 py-2 bg-purple-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1";
      btnMarkText.textContent = "Marked for Review";
    } else {
      btnMark.className = "px-3 py-2 border border-purple-200 text-purple-700 hover:bg-purple-50 rounded-xl text-xs font-semibold transition flex items-center space-x-1";
      btnMarkText.textContent = "Mark for Review";
    }
  } else if (state.quizMode === 'RAPID_FIRE') {
    btnPrev.classList.add('hidden');
  } else {
    btnPrev.classList.toggle('hidden', state.currentQIndex === 0);
  }

  if (state.quizMode !== 'RAPID_FIRE' && state.currentQIndex === total - 1) {
    btnNext.classList.add('hidden');
    btnSubmit.classList.remove('hidden');
  } else {
    btnNext.classList.remove('hidden');
    btnSubmit.classList.add('hidden');
  }

  lucide.createIcons();
}

function selectOption(optKey) {
  const q = state.activeQuestions[state.currentQIndex];
  if (!q) return;

  if (state.quizMode === 'PRACTICE') {
    if (state.userAnswers[q.id]) return; // locked until "Try again"
    state.userAnswers[q.id] = optKey;
    const ok = optKey === q.correct_option;
    state.userData.practice[q.id] = { r: ok ? 'C' : 'W', d: new Date().toISOString() };
    // Wrong answers go to the 20th Notebook; Spaced Review only if switched on in Settings (off by default)
    if (!ok) {
      const pSid = q.subject_id || (state.activeSubject ? state.activeSubject.subject_id : 'GENERAL');
      recordMistake(q, pSid, optKey);
      scheduleSrsReview(q.id, pSid, false, 'practice');
    }
    pgLog(q, optKey, ok, 'PRACTICE');
    saveUserData();
    renderCurrentQuestion();
    renderPaletteGrid();
    return;
  }

  state.userAnswers[q.id] = optKey;

  if (state.quizMode === 'RAPID_FIRE') {
    const isCorrect = optKey === q.correct_option;
    const sId = q.subject_id || (state.activeSubject ? state.activeSubject.subject_id : 'GENERAL');

    if (isCorrect) {
      state.rfStreak++;
      if (state.rfStreak > state.rfBestStreak) state.rfBestStreak = state.rfStreak;
    } else {
      state.rfStreak = 0;
      recordMistake(q, sId, optKey);
      scheduleSrsReview(q.id, sId, false, srsSourceNow());
    }

    pgLog(q, optKey, isCorrect, 'RAPID_FIRE');
    state.rfAnsweredRecord.push({ question: q, userChoice: optKey, isCorrect });

    // Update live RF stats
    document.getElementById('rf-streak').textContent = state.rfStreak;
    const totalAns = state.rfAnsweredRecord.length;
    const correctAns = state.rfAnsweredRecord.filter(r => r.isCorrect).length;
    document.getElementById('rf-accuracy').textContent = `${Math.round((correctAns / totalAns) * 100)}%`;

    if (state.rfInstant) {
      showRapidFireFeedback(q, optKey);
    } else {
      // Auto-advance in rapid speed mode
      setTimeout(() => nextQuestion(), 200);
    }
  } else if (state.quizMode === 'GRAND_TEST') {
    renderPaletteGrid();
  }

  renderCurrentQuestion();
}

function showPracticeFeedback(q, userChoice) {
  const box = document.getElementById('rf-instant-feedback');
  if (!box) return;
  const prev = practiceOf(q.id);
  if (!userChoice) {
    if (!prev) return;
    box.classList.remove('hidden');
    box.className = "p-3 rounded-xl border text-xs animate-fade-in " + (prev.r === 'C' ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800");
    box.textContent = prev.r === 'C' ? 'You got this one right last time.' : 'You got this one wrong last time.';
    return;
  }
  const ok = userChoice === q.correct_option;
  box.classList.remove('hidden');
  box.className = "p-4 rounded-xl border text-xs space-y-1.5 animate-fade-in " + (ok ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-rose-200 bg-rose-50 text-rose-950");
  const rat = String((q.explanation && q.explanation.rationale) || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
  const pearl = q.explanation && q.explanation.high_yield_pearl ? String(q.explanation.high_yield_pearl).replace(/&/g, '&amp;').replace(/</g, '&lt;') : '';
  box.innerHTML = '<div class="font-bold ' + (ok ? 'text-emerald-800' : 'text-rose-800') + '">' + (ok ? 'Correct!' : 'Incorrect. The correct answer is option ' + q.correct_option + '.') + (ok ? '' : ' (saved to 20th Notebook)') + '</div>'
    + '<p class="leading-relaxed text-slate-700">' + rat + '</p>'
    + (pearl ? '<div class="text-[11px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2"><b>High-Yield Pearl:</b> ' + pearl + '</div>' : '');
  pgAttachWhy(box, q, ok);
}

function showRapidFireFeedback(q, userChoice) {
  const instantBox = document.getElementById('rf-instant-feedback');
  if (!instantBox) return;

  const isCorrect = userChoice === q.correct_option;
  instantBox.classList.remove('hidden');

  if (isCorrect) {
    instantBox.className = "p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 text-xs space-y-1 animate-fade-in";
    instantBox.innerHTML = `
      <div class="flex items-center space-x-1.5 font-bold text-emerald-800">
        <i data-lucide="check-circle" class="w-4 h-4 text-emerald-600"></i>
        <span>Correct! Option ${q.correct_option} is the right answer.</span>
      </div>
      <p class="text-emerald-950">${q.explanation.rationale.substring(0, 220)}...</p>
    `;
  } else {
    instantBox.className = "p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 text-xs space-y-1 animate-fade-in";
    instantBox.innerHTML = `
      <div class="flex items-center space-x-1.5 font-bold text-rose-800">
        <i data-lucide="x-circle" class="w-4 h-4 text-rose-600"></i>
        <span>Incorrect. Correct answer is Option ${q.correct_option}. (Saved to 20th Notebook)</span>
      </div>
      <p class="text-rose-950">${q.explanation.rationale.substring(0, 220)}...</p>
      <div class="pt-1 text-[11px] font-semibold text-rose-700">Pearl: ${q.explanation.high_yield_pearl}</div>
    `;
  }
  pgAttachWhy(instantBox, q, isCorrect);
  lucide.createIcons();
}

function nextQuestion() {
  if (state.currentQIndex < state.activeQuestions.length - 1) {
    state.currentQIndex++;
    renderCurrentQuestion();
    if (state.quizMode === 'GRAND_TEST') renderPaletteGrid();
  } else if (state.quizMode === 'RAPID_FIRE') {
    // If bank finished, complete drill
    finishRapidFire();
  }
}

function prevQuestion() {
  if (state.currentQIndex > 0) {
    state.currentQIndex--;
    renderCurrentQuestion();
    if (state.quizMode === 'GRAND_TEST') renderPaletteGrid();
  }
}

function confirmExitQuiz() {
  if (confirm(state.quizMode === 'PRACTICE' ? "Exit practice? Your progress so far is saved." : "Are you sure you want to exit the current test?")) {
    stopTimer();
    if (state.quizMode === 'RAPID_FIRE') {
      finishRapidFire();
    } else if (state.activeSubject) {
      switchView('subject');
    } else {
      goToHome();
    }
  }
}

// -------------------------------------------------------------
// POST-TEST COMPLETION & UNIT TEST SCORING
// -------------------------------------------------------------
function submitPractice() {
  stopTimer();
  const answered = state.activeQuestions.filter(q => state.userAnswers[q.id]);
  if (!answered.length) { returnToActiveSubject(); return; }
  const c = answered.filter(q => state.userAnswers[q.id] === q.correct_option).length;
  const w = answered.length - c;
  const pct = Math.round((c / answered.length) * 100);
  state.userData.history.push({
    mode: 'PRACTICE',
    subjectId: state.activeSubject ? state.activeSubject.subject_id : '',
    unitId: state.activeUnit ? state.activeUnit.unit_id : '',
    title: state.activeUnit ? state.activeUnit.title : 'Practice',
    date: new Date().toISOString(),
    totalQ: answered.length, correct: c, wrong: w,
    elapsedSeconds: state.elapsedSeconds
  });
  saveUserData();
  document.getElementById('post-title').textContent = 'Practice Session Complete';
  document.getElementById('post-badge').textContent = `${answered.length} of ${state.activeQuestions.length} attempted`;
  document.getElementById('score-percent').textContent = `${pct}%`;
  document.getElementById('score-percent-label').textContent = 'Accuracy';
  document.getElementById('post-summary-text').textContent =
    `${c} correct and ${w} wrong in ${formatTime(state.elapsedSeconds)}. Your tile progress is saved for next time, and mistakes are in your 20th Notebook. Practice does not feed Spaced Review.`;
  document.getElementById('review-correct-count').textContent = `${c} Correct`;
  document.getElementById('review-wrong-count').textContent = `${w} Wrong`;
  document.getElementById('gt-breakdown-card').classList.add('hidden');
  if (state.activeUnit && state.activeUnit.quick_theory) {
    document.getElementById('post-theory-section').classList.remove('hidden');
    renderUnitQuickTheory(state.activeUnit);
  } else {
    document.getElementById('post-theory-section').classList.add('hidden');
  }
  renderReviewList(answered);
  switchView('post-test');
}

function submitQuiz() {
  if (state.quizMode === 'PRACTICE') { submitPractice(); return; }
  stopTimer();
  const total = state.activeQuestions.length;
  let correctCount = 0;
  let wrongCount = 0;

  state.activeQuestions.forEach(q => {
    const chosen = state.userAnswers[q.id];
    const sId = q.subject_id || (state.activeSubject ? state.activeSubject.subject_id : 'GENERAL');
    if (!chosen) return; // unanswered: untouched, stays due
    pgLog(q, chosen, chosen === q.correct_option, state.quizMode);
    if (chosen === q.correct_option) {
      correctCount++;
      scheduleSrsReview(q.id, sId, true);
    } else {
      wrongCount++;
      recordMistake(q, sId, chosen);
      scheduleSrsReview(q.id, sId, false);
    }
  });

  const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;

  // Save history
  state.userData.history.push({
    mode: state.quizMode === 'SRS' ? 'SRS' : 'UNIT',
    subjectId: state.quizMode === 'SRS' ? '' : (state.activeSubject ? state.activeSubject.subject_id : ''),
    unitId: state.quizMode === 'SRS' ? '' : (state.activeUnit ? state.activeUnit.unit_id : ''),
    title: state.quizMode === 'SRS' ? (total === 1 ? 'Spaced Review (single question)' : 'Spaced Review drill') : (state.activeUnit ? state.activeUnit.title : 'Unit Test'),
    date: new Date().toISOString(),
    totalQuestions: total,
    correctCount: correctCount,
    wrongCount: wrongCount,
    elapsedSeconds: state.elapsedSeconds
  });
  saveUserData();

  // Populate Post-Test Banner
  const srsDrill = state.quizMode === 'SRS';
  document.getElementById('post-title').textContent = srsDrill ? (total === 1 ? 'Review done' : 'Spaced Review drill complete') : "Diagnostic Test Complete!";
  document.getElementById('post-badge').textContent = srsDrill ? (correctCount + wrongCount) + ' of ' + total + ' answered' : (pct >= 70 ? "Mastery Achieved!" : "Needs Revision");
  document.getElementById('score-percent').textContent = `${pct}%`;
  document.getElementById('score-percent-label').textContent = "Score";
  document.getElementById('post-summary-text').textContent = 
    srsDrill ? `You got ${correctCount} right and ${wrongCount} wrong in ${formatTime(state.elapsedSeconds)}. Right answers move to their next review step; wrong ones start again at the first step.` + ((total - correctCount - wrongCount) ? ` ${total - correctCount - wrongCount} unanswered ${total - correctCount - wrongCount === 1 ? 'stays' : 'stay'} due.` : '')
    : `You got ${correctCount} correct out of ${total} questions in ${formatTime(state.elapsedSeconds)}. All mistakes stay in your Daily Spaced Review queue until completed.`;

  document.getElementById('review-correct-count').textContent = `${correctCount} Correct`;
  document.getElementById('review-wrong-count').textContent = `${wrongCount} Wrong`;
  document.getElementById('gt-breakdown-card').classList.add('hidden');

  // Populate Quick Theory Section for this unit
  if (state.activeUnit && state.activeUnit.quick_theory) {
    document.getElementById('post-theory-section').classList.remove('hidden');
    renderUnitQuickTheory(state.activeUnit);
  } else {
    document.getElementById('post-theory-section').classList.add('hidden');
  }

  // Populate Question Breakdown
  renderReviewList(state.activeQuestions);
  switchView('post-test');
}

function renderUnitQuickTheory(unit) {
  const theory = unit.quick_theory;
  document.getElementById('theory-summary-text').textContent = theory.summary;

  // Core tables
  const tablesContainer = document.getElementById('theory-tables-container');
  tablesContainer.innerHTML = '';
  if (theory.core_tables) {
    theory.core_tables.forEach(tbl => {
      const card = document.createElement('div');
      card.className = "bg-white/5 border border-white/10 rounded-xl p-4 overflow-x-auto";
      let html = `<h5 class="text-xs font-bold uppercase tracking-wider text-amber-300 mb-2.5">${thTitle(tbl)}</h5>`;
      html += `<table class="w-full text-left text-xs text-slate-200"><thead><tr class="border-b border-white/10 text-white font-semibold">`;
      tbl.headers.forEach(h => html += `<th class="py-1.5 px-2.5">${h}</th>`);
      html += `</tr></thead><tbody class="divide-y divide-white/5">`;
      tbl.rows.forEach(r => {
        html += `<tr>`;
        r.forEach((cell, idx) => html += `<td class="py-2 px-2.5 ${idx === 0 ? 'font-semibold text-white' : ''}">${cell}</td>`);
        html += `</tr>`;
      });
      html += `</tbody></table>`;
      card.innerHTML = html;
      tablesContainer.appendChild(card);
    });
  }

  // Mnemonics
  const mnemonicsList = document.getElementById('theory-mnemonics-list');
  mnemonicsList.innerHTML = '';
  if (theory.high_yield_mnemonics) {
    theory.high_yield_mnemonics.forEach(m => {
      const li = document.createElement('li');
      li.className = "flex items-start space-x-2";
      li.innerHTML = `
        <span class="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0"></span>
        <div>${thMn(m, 'text-white')}</div>
      `;
      mnemonicsList.appendChild(li);
    });
  }
}

function renderReviewList(questions) {
  const container = document.getElementById('post-test-questions-list');
  container.innerHTML = '';
  const gtTimed = state.quizMode === 'GRAND_TEST' && state.gtTimes && Object.keys(state.gtTimes).length > 0;
  if (gtTimed) gtTimeSummary(container, questions);

  questions.forEach((q, idx) => {
    const userChoice = state.userAnswers[q.id];
    const isCorrect = userChoice === q.correct_option;
    const card = document.createElement('div');
    const skipped = !userChoice;
    card.className = `bg-white border rounded-2xl p-5 sm:p-6 shadow-sm space-y-4 ${
      isCorrect ? 'border-emerald-200 bg-emerald-50/20' : skipped ? 'border-slate-200 bg-slate-50/40' : 'border-rose-200 bg-rose-50/20'
    }`;

    let optionsHtml = '';
    Object.entries(q.options).forEach(([k, v]) => {
      let optStyle = 'border-slate-200 text-slate-700 bg-white';
      let icon = '';
      if (k === q.correct_option) {
        optStyle = 'border-emerald-500 bg-emerald-50 text-emerald-900 font-bold';
        icon = '<i data-lucide="check" class="w-4 h-4 text-emerald-600 inline ml-1"></i>';
      } else if (k === userChoice && !isCorrect) {
        optStyle = 'border-rose-500 bg-rose-50 text-rose-900 font-bold';
        icon = '<i data-lucide="x" class="w-4 h-4 text-rose-600 inline ml-1"></i>';
      }

      optionsHtml += `
        <div class="p-3 rounded-xl border text-xs sm:text-sm flex items-start space-x-2.5 ${optStyle}">
          <span class="font-bold shrink-0">${k}.</span>
          <span class="flex-1">${v}</span>
          ${icon}
        </div>
      `;
    });

    let distractorsHtml = '';
    if (q.explanation.distractor_analysis) {
      distractorsHtml += `<div class="mt-3 pt-3 border-t border-slate-100 text-xs space-y-1.5">
        <span class="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Distractor Analysis:</span>`;
      Object.entries(q.explanation.distractor_analysis).forEach(([k, text]) => {
        distractorsHtml += `<p class="text-slate-600"><b class="text-slate-800">Option ${k}:</b> ${text}</p>`;
      });
      distractorsHtml += `</div>`;
    }

    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <span class="w-6 h-6 rounded-full ${isCorrect ? 'bg-emerald-600' : skipped ? 'bg-slate-400' : 'bg-rose-600'} text-white flex items-center justify-center text-xs font-bold">
            ${idx + 1}
          </span>
          <span class="text-xs font-bold ${isCorrect ? 'text-emerald-700' : skipped ? 'text-slate-500' : 'text-rose-700'}">
            ${rvMarkLabel(isCorrect, skipped)}
          </span>
        </div>
        <span class="flex items-center gap-2 flex-wrap justify-end">${gtTimed ? gtTimeChip(q.id) : ''}${bmBtnHtml(q.id, q.subject_id)}<span class="text-[11px] font-semibold text-slate-400">${q.exam_source}</span></span>
      </div>

      <p class="text-sm font-semibold text-slate-900 leading-snug">${q.question}</p>
      <button onclick="reportQuestion('${q.id}')" class="text-[11px] text-slate-400 hover:text-rose-600 underline">Report this question</button>

      ${q.image_url ? `
        <div class="my-2.5 inline-block cursor-pointer" onclick="openImageModal('${q.image_url}', '${q.exam_source || 'Clinical Image'} • ${q.topic || ''}')">
          <div class="flex items-center space-x-2.5 p-2 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200 transition">
            <img src="${q.image_url}" alt="Clinical Diagram" class="h-20 w-auto rounded-lg object-contain bg-white border border-slate-200" />
            <span class="text-xs text-brand-600 font-bold flex items-center space-x-1 pr-1">
              <i data-lucide="zoom-in" class="w-3.5 h-3.5"></i>
              <span>View High-Res Diagram</span>
            </span>
          </div>
        </div>
        ${q.image_credit ? `<div class="text-[10px] text-slate-400 mb-2">Image: ${q.image_credit}</div>` : ''}
      ` : ''}

      <div class="space-y-2">
        ${optionsHtml}
      </div>

      <div class="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3.5 text-xs text-indigo-950 space-y-2">
        <div class="font-bold flex items-center space-x-1.5 text-indigo-900">
          <i data-lucide="book-open" class="w-3.5 h-3.5 text-indigo-600"></i>
          <span>Clinical Rationale</span>
        </div>
        <p class="leading-relaxed text-slate-700">${q.explanation.rationale.replace(/\n/g, '<br>')}</p>
        
        <div class="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-amber-900 font-medium">
          <b class="text-amber-800">High-Yield Pearl:</b> ${q.explanation.high_yield_pearl}
        </div>

        ${distractorsHtml}
      </div>
    `;

    pgAttachWhyReview(card, q, isCorrect);
    container.appendChild(card);
  });

  lucide.createIcons();
}

function retakeCurrentUnit() {
  if (state.activeUnit) {
    startUnitQuiz(state.activeUnit.unit_id);
  } else {
    goToHome();
  }
}

// -------------------------------------------------------------
// SPACED REPETITION (SRS) & OVERDUE DAYS LOGIC
// -------------------------------------------------------------
const SRS_ALL_STEPS = [1, 3, 7, 14];
const SRS_DEFAULT_SRC = { daily: true, rf: true, revdrill: true, gt: true, mini: true, rev: true, practice: false };
const SRS_SRC_LABEL = [
  ['daily', 'Daily Target', 'including Catch up and Do more'],
  ['rf', 'Rapid Fire Drill', ''],
  ['revdrill', 'Revision drill', ''],
  ['gt', 'Full Grand Tests', 'NEET PG and INI-CET'],
  ['mini', 'Mini-GTs', 'NEET PG and INI-CET'],
  ['rev', 'Revision tests', 'Revision GT, Revision Mini-GT, Custom'],
  ['practice', 'Practice', 'subject units']
];
function srsPrefs() {
  const p = state.userData.srsPrefs || {};
  let steps = (Array.isArray(p.steps) ? p.steps : SRS_ALL_STEPS).filter(x => SRS_ALL_STEPS.includes(x)).sort((a, b) => a - b);
  if (!steps.length) steps = [1];
  return { steps, src: Object.assign({}, SRS_DEFAULT_SRC, p.src || {}) };
}
function srsWants(src) { return !!srsPrefs().src[src]; }
// which mode is answering right now (null = a Spaced Review session or a single-question review)
function srsSourceNow() {
  if (state.quizMode === 'RAPID_FIRE') {
    if (state.dtCtx && state.dtCtx.kind) return 'daily';
    if (state.rfScope === 'LIST' && state.rfTitle === '⚡ Revision Drill') return 'revdrill';
    return 'rf';
  }
  if (state.quizMode === 'GRAND_TEST') {
    const k = state.gtExamType || '';
    if (k === 'PRESET') return 'rev';
    return /MINI/.test(k) ? 'mini' : 'gt';
  }
  if (state.quizMode === 'PRACTICE') return 'practice';
  return null;
}
function srsDayStart(days) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return d.toISOString(); }
function srsStepOf(rec, steps) { steps = steps || srsPrefs().steps; return Math.min(steps.length, Math.max(1, steps.filter(s => s <= (rec.interval || 0)).length)); }
function srsNextStep(rec, steps) { steps = steps || srsPrefs().steps; const n = steps.find(s => s > (rec.interval || 0)); return n == null ? null : n; }
function scheduleSrsReview(qId, subjectId, isCorrect, source) {
  const steps = srsPrefs().steps;
  let rec = state.userData.srs[qId];
  if (!isCorrect) {
    if (source && !srsWants(source)) return;
    if (!rec) rec = { subjectId: subjectId, reps: 0 };
    rec.reps = 0;
    rec.interval = steps[0];
  } else {
    if (!rec) return; // a right answer never adds a new review
    const next = srsNextStep(rec, steps);
    if (next == null) {
      // passed the last ticked step: retire (kept in srsDone; still in the Notebook and the answer log)
      if (!state.userData.srsDone || typeof state.userData.srsDone !== 'object') state.userData.srsDone = {};
      state.userData.srsDone[qId] = Object.assign({}, rec, { retired: new Date().toISOString() });
      delete state.userData.srs[qId];
      return;
    }
    rec.reps = (rec.reps || 0) + 1;
    rec.interval = next;
  }
  rec.lastReviewedDate = new Date().toISOString();
  rec.nextReviewDate = srsDayStart(rec.interval);
  state.userData.srs[qId] = rec;
  if (state.userData.srsDone && state.userData.srsDone[qId]) delete state.userData.srsDone[qId];
}
function srsDueRecs(beforeTs) {
  const t = beforeTs || Date.now();
  return Object.entries(state.userData.srs || {}).filter(([id, r]) => new Date(r.nextReviewDate).getTime() <= t);
}
// due at any time today (used to keep Daily Target revision picks apart from Spaced Review)
function srsDueIdsToday() { return srsDueRecs(new Date(srsDayStart(1)).getTime() - 1).map(e => e[0]); }
function srsNextDueDate() {
  const ts = Object.values(state.userData.srs || {}).map(r => new Date(r.nextReviewDate).getTime()).filter(x => x > Date.now());
  return ts.length ? new Date(Math.min(...ts)) : null;
}

// ---- Settings: Spaced Review section ----
function srsSaveSteps() {
  const steps = SRS_ALL_STEPS.filter(s => { const el = document.getElementById('srs-step-' + s); return el && el.checked; });
  const msg = document.getElementById('srs-steps-msg');
  if (!steps.length) {
    const el = document.getElementById('srs-step-1'); if (el) el.checked = true;
    if (msg) msg.textContent = 'Keep at least one step ticked.';
    steps.push(1);
  } else if (msg) msg.textContent = '';
  state.userData.srsPrefs = Object.assign({}, state.userData.srsPrefs || {}, { steps });
  saveUserData(); srsStepsSummary();
}
function srsSaveSrc(k, on) {
  const p = state.userData.srsPrefs || {};
  state.userData.srsPrefs = Object.assign({}, p, { src: Object.assign({}, p.src || {}, { [k]: !!on }) });
  saveUserData();
}
function srsResetPrefs() { delete state.userData.srsPrefs; saveUserData(); srsRenderSettings(); }
function srsStepsSummary() {
  const el = document.getElementById('srs-steps-sum'); if (!el) return;
  const s = srsPrefs().steps;
  el.textContent = 'A wrong answer comes back after ' + s.map(x => x + (x === 1 ? ' day' : ' days')).join(', then ') + '. Right at the last step and it leaves the queue.';
}
function srsRenderSettings() {
  const box = document.getElementById('settings-srs'); if (!box) return;
  const P = srsPrefs();
  const chk = (id, on, onchg) => '<input id="' + id + '" type="checkbox" ' + (on ? 'checked ' : '') + 'onchange="' + onchg + '" class="w-4 h-4 accent-rose-600 shrink-0">';
  box.innerHTML = '<div class="bg-rose-50/60 border border-rose-200 rounded-xl p-3.5 space-y-3">' +
    '<div class="flex items-center justify-between gap-2"><div class="text-xs font-bold text-slate-800">Spaced Review</div>' +
    '<button onclick="srsResetPrefs()" class="text-[11px] font-semibold text-slate-500 hover:text-slate-800 underline">Reset to default</button></div>' +
    '<div><div class="text-[11px] font-bold text-slate-700">Review steps</div>' +
    '<div class="grid grid-cols-4 gap-2 mt-1.5">' + SRS_ALL_STEPS.map(s =>
      '<label class="flex items-center justify-center gap-1.5 bg-white border border-rose-200 rounded-lg py-1.5 text-xs font-semibold text-slate-800 cursor-pointer">' +
      chk('srs-step-' + s, P.steps.includes(s), 'srsSaveSteps()') + s + (s === 1 ? ' day' : ' days') + '</label>').join('') + '</div>' +
    '<p id="srs-steps-sum" class="text-[11px] text-slate-600 leading-relaxed mt-1.5"></p><p id="srs-steps-msg" class="text-[11px] font-semibold text-rose-700"></p></div>' +
    '<div><div class="text-[11px] font-bold text-slate-700">Add wrong answers from</div><div class="space-y-1.5 mt-1.5">' +
    SRS_SRC_LABEL.map(([k, t, sub]) => '<label class="flex items-center gap-2 text-xs text-slate-800 cursor-pointer">' + chk('srs-src-' + k, P.src[k], 'srsSaveSrc(\'' + k + '\', this.checked)') +
      '<span><b class="font-semibold">' + t + '</b>' + (sub ? ' <span class="text-slate-500">(' + sub + ')</span>' : '') + '</span></label>').join('') + '</div>' +
    '<p class="text-[11px] text-slate-500 leading-relaxed mt-1.5">Changes apply to answers from now on; questions already in the queue stay. Wrong answers from every mode still go to the 20th Notebook.</p></div></div>';
  srsStepsSummary();
}

function getDueSrsQuestions() {
  const now = Date.now();
  const due = [];

  Object.entries(state.userData.srs).forEach(([qId, item]) => {
    const nextDate = new Date(item.nextReviewDate).getTime();
    if (now >= nextDate) {
      const q = findQuestionById(qId);
      if (q) {
        const daysOverdue = Math.max(0, Math.floor((now - nextDate) / 86400000));
        due.push({ question: q, subjectId: item.subjectId, srs: item, daysOverdue });
      }
    }
  });

  // Sort by highest overdue first
  due.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return due;
}

function renderSrsView() {
  const container = document.getElementById('srs-queue-container');
  const btnStart = document.getElementById('btn-start-srs-quiz');
  if (!container) return;
  container.innerHTML = '';
  rmUndoBanner(container, 'srs');
  { const hs = document.getElementById('srs-hub-steps'); if (hs) { const st = srsPrefs().steps; hs.textContent = st.length > 1 ? st.slice(0, -1).join(', ') + ' and ' + st[st.length - 1] : String(st[0]); } }

  const dueList = getDueSrsQuestions();

  if (dueList.length === 0) {
    btnStart.classList.add('hidden');
    container.insertAdjacentHTML('beforeend', `
      <div class="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3">
        <div class="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center">
          <i data-lucide="check-circle" class="w-6 h-6"></i>
        </div>
        <h4 class="text-base font-bold text-slate-900">All Spaced Reviews Up to Date!</h4>
        <p class="text-xs text-slate-500 max-w-sm mx-auto">Nothing is due. Questions you get wrong come back here after ${srsPrefs().steps.join(', ')} days (change the steps and which modes count in Settings).${srsNextDueDate() ? ' Next review: ' + srsNextDueDate().toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + '.' : ''}</p>
      </div>
    `);
    lucide.createIcons();
    return;
  }

  btnStart.classList.remove('hidden');

  dueList.forEach(item => {
    const q = item.question;
    const card = document.createElement('div');
    card.className = "bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center justify-between gap-4 hover:border-brand-400 transition";
    
    const overdueBadge = item.daysOverdue === 0
      ? `<span class="bg-rose-50 text-rose-700 text-[10px] font-bold px-2 py-0.5 rounded-md">Due Today</span>`
      : `<span class="bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-md animate-pulse">Overdue by ${item.daysOverdue} ${item.daysOverdue === 1 ? 'Day' : 'Days'}</span>`;

    card.innerHTML = `
      <div class="space-y-1 min-w-0">
        <div class="flex items-center space-x-2">
          ${overdueBadge}
          <span class="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap">${srsStepLabel(item.srs)}</span>
          <span class="text-[11px] font-semibold text-slate-400">${item.subjectId}</span>
          <span class="text-[11px] text-slate-400">• ${q.exam_source}</span>
        </div>
        <h5 class="text-xs sm:text-sm font-semibold text-slate-900 truncate">${q.question}</h5>
        <p class="text-[11px] text-slate-500 line-clamp-1">${q.explanation.rationale}</p>
      </div>

      <div class="flex flex-col items-end gap-1 shrink-0">
      <button onclick="startSingleQuestionDrill('${q.id}')" class="px-3 py-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 rounded-xl text-xs font-bold transition shrink-0">
        Review
      </button>
      <button onclick="srsRemove('${q.id}')" class="btn-rm" title="Remove from Spaced Review">Remove</button>
      </div>
    `;
    container.appendChild(card);
  });

  lucide.createIcons();
}

async function startSrsDrill() {
  if (!(await ensureSubjects(dueSrsSubjectIds()))) return;
  startSrsDrillNow();
}

function startSrsDrillNow() {
  state.dtCtx = null;
  const due = getDueSrsQuestions();
  if (due.length === 0) return;

  state.quizMode = 'SRS';
  state.activeUnit = null;
  state.activeQuestions = due.map(d => d.question);
  state.currentQIndex = 0;
  state.userAnswers = {};
  state.elapsedSeconds = 0;

  document.getElementById('rf-stats-bar').classList.add('hidden');
  document.getElementById('btn-mark-review').classList.add('hidden');
  document.getElementById('btn-clear-choice').classList.add('hidden');
  document.getElementById('btn-open-palette').classList.add('hidden');
  document.getElementById('gt-palette-column').classList.add('hidden');
  document.getElementById('quiz-left-column').className = "lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 shadow-sm space-y-5";

  document.getElementById('quiz-unit-title').textContent = "Daily Spaced Review Drill";
  document.getElementById('quiz-unit-subtitle').textContent = `${state.activeQuestions.length} Overdue Questions`;

  startTimer();
  switchView('quiz');
  renderCurrentQuestion();
}

function startSingleQuestionDrill(qId) {
  state.dtCtx = null;
  const q = findQuestionById(qId);
  if (!q) return;

  state.quizMode = 'SRS';
  state.activeUnit = null;
  state.activeQuestions = [q];
  state.currentQIndex = 0;
  state.userAnswers = {};
  state.elapsedSeconds = 0;

  document.getElementById('rf-stats-bar').classList.add('hidden');
  document.getElementById('btn-mark-review').classList.add('hidden');
  document.getElementById('btn-clear-choice').classList.add('hidden');
  document.getElementById('btn-open-palette').classList.add('hidden');
  document.getElementById('gt-palette-column').classList.add('hidden');

  document.getElementById('quiz-unit-title').textContent = "Single Question Review";
  document.getElementById('quiz-unit-subtitle').textContent = q.topic;

  startTimer();
  switchView('quiz');
  renderCurrentQuestion();
}

// -------------------------------------------------------------
// 20TH NOTEBOOK (ALL TOPICS MISTAKE VAULT)
// -------------------------------------------------------------
function recordMistake(q, subjectId, userChoice) {
  state.userData.mistakes[q.id] = {
    q: q,
    subjectId: subjectId,
    userChoice: userChoice,
    lastWrongDate: new Date().toISOString()
  };
}

function renderNotebookView() {
  nbRenderTabs();
  if ((state.nbTab || 'M') === 'B') { bmRenderList(); return; }
  nbRenderMistakes();
}
function nbRenderMistakes() {
  const container = document.getElementById('notebook-container');
  const pillsContainer = document.getElementById('notebook-subject-pills');
  if (!container || !pillsContainer) return;

  const mistakes = Object.values(state.userData.mistakes).filter(m => !m.hidden);

  // Render subject filter pills
  const subjectsWithMistakes = ['ALL', ...new Set(mistakes.map(m => m.subjectId))];
  pillsContainer.innerHTML = '';
  subjectsWithMistakes.forEach(sId => {
    const isAct = state.selectedNotebookSubjectId === sId;
    const btn = document.createElement('button');
    btn.className = `px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
      isAct ? 'bg-amber-600 text-white font-bold shadow-sm' : 'border border-slate-200 text-slate-600 hover:bg-slate-100'
    }`;
    btn.textContent = sId === 'ALL' ? `All (${mistakes.length})` : sId;
    btn.onclick = () => {
      state.selectedNotebookSubjectId = sId;
      renderNotebookView();
    };
    pillsContainer.appendChild(btn);
  });

  container.innerHTML = '';
  rmUndoBanner(container, 'nb');

  let filtered = mistakes;
  if (state.selectedNotebookSubjectId !== 'ALL') {
    filtered = filtered.filter(m => m.subjectId === state.selectedNotebookSubjectId);
  }

  const query = (document.getElementById('notebook-search')?.value || '').toLowerCase().trim();
  if (query) {
    filtered = filtered.filter(m => 
      m.q.question.toLowerCase().includes(query) || 
      m.q.explanation.rationale.toLowerCase().includes(query) ||
      m.q.explanation.high_yield_pearl.toLowerCase().includes(query)
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3">
        <div class="w-12 h-12 rounded-full bg-amber-100 text-amber-600 mx-auto flex items-center justify-center">
          <i data-lucide="bookmark-check" class="w-6 h-6"></i>
        </div>
        <h4 class="text-base font-bold text-slate-900">No Mistakes Recorded</h4>
        <p class="text-xs text-slate-500 max-w-sm mx-auto">Questions you get wrong in Unit Tests, Grand Tests, or Rapid Fire will automatically appear here with their high-yield pearls.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  filtered.forEach(m => {
    const q = m.q;
    const card = document.createElement('div');
    card.className = "bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3";
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <span class="bg-amber-100 text-amber-800 text-[11px] font-bold px-2 py-0.5 rounded-md">${m.subjectId}</span>
          <span class="text-xs font-semibold text-slate-500">${q.exam_source}</span>
        </div>
        <div class="flex items-center gap-1"><span class="text-[11px] text-slate-400">${new Date(m.lastWrongDate).toLocaleDateString()}</span>
        <button onclick="nbRemove('${q.id}')" class="btn-rm" title="Remove from 20th Notebook">Remove</button></div>
      </div>

      <h5 class="text-sm font-semibold text-slate-900 leading-snug">${q.question}</h5>

      ${q.image_url ? `
        <div class="my-2 inline-block cursor-pointer" onclick="openImageModal('${q.image_url}', '${q.exam_source || 'Clinical Image'} • ${q.topic || ''}')">
          <div class="flex items-center space-x-2 p-1.5 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200 transition">
            <img src="${q.image_url}" alt="Clinical Diagram" class="h-14 w-auto rounded-lg object-contain bg-white border border-slate-200" />
            <span class="text-xs text-brand-600 font-bold flex items-center space-x-1">
              <i data-lucide="zoom-in" class="w-3.5 h-3.5"></i>
              <span>Inspect Diagram</span>
            </span>
          </div>
        </div>
        ${q.image_credit ? `<div class="text-[10px] text-slate-400 mb-2">Image: ${q.image_credit}</div>` : ''}
      ` : ''}

      <div class="bg-rose-50 border border-rose-100 rounded-xl p-3 text-xs text-rose-950 space-y-1.5">
        <div class="flex items-center justify-between font-bold">
          <span class="text-rose-700">Your Answer: Option ${m.userChoice || 'Unattempted'}</span>
          <span class="text-emerald-700 font-bold">Correct: Option ${q.correct_option} (${q.options[q.correct_option]})</span>
        </div>
        <p class="text-slate-700">${q.explanation.rationale.replace(/\n/g, '<br>')}</p>
        <div class="bg-amber-100/70 border border-amber-200 rounded-lg p-2.5 text-amber-950 font-semibold text-[11px]">
          <b>20th-Notebook Pearl:</b> ${q.explanation.high_yield_pearl}
        </div>
        ${pgWhyLine(q.id)}
      </div>
    `;
    container.appendChild(card);
  });

  lucide.createIcons();
}

function filterNotebook() {
  renderNotebookView();
}

// -------------------------------------------------------------
// QUICK HIGH-YIELD THEORY (GLOBAL VAULT)
// -------------------------------------------------------------

// -------------------------------------------------------------
// QUICK THEORY: DETAILED NOTES (markdown, lazy-loaded from data/theory.js)
// -------------------------------------------------------------
const GENERAL_THEORY = {
  subject_id: 'GENERAL_REF', name: 'General Reference', icon: 'book-open',
  units: [
    { unit_id: 'GEN_OVERVIEW', unit_number: '', general: true, title: 'Exam overview, study plan and source notes',
      quick_theory: { summary: 'How NEET PG tests you, the question-solving routine, terms used throughout, the study plan, and notes on sources and coverage.' } },
    { unit_id: 'GEN_INDEX', unit_number: '', general: true, title: 'Alternate spellings and terms index',
      quick_theory: { summary: 'Alternate spellings and synonyms of high-yield topics (for example galactosaemia / galactosemia), each pointing to the subject where it is covered.' } },
    { unit_id: 'GEN_GLOSSARY', unit_number: '', general: true, title: 'Glossary of acronyms and abbreviations',
      quick_theory: { summary: 'Expansions of the acronyms and abbreviations used across all Quick Theory notes.' } }
  ]
};
function theorySubjectList() { return state.curriculum.subjects.concat([GENERAL_THEORY]); }
function activeTheorySubject() {
  const list = theorySubjectList();
  const id = state.selectedTheorySubjectId || list[0].subject_id;
  return list.find(s => s.subject_id === id) || null;
}

let _theoryNotesPromise = null;
function loadTheoryNotes() {
  if (window.__theoryNotes) return Promise.resolve();
  if (_theoryNotesPromise) return _theoryNotesPromise;
  _theoryNotesPromise = new Promise(resolve => {
    const el = document.createElement('script');
    el.src = 'data/theory.js?v=' + DATA_VERSION;
    el.onload = () => resolve();
    el.onerror = () => { _theoryNotesPromise = null; resolve(); };
    document.head.appendChild(el);
  });
  return _theoryNotesPromise;
}

function mdInline(s) {
  let t = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  t = t.replace(/(^|[^*\w])\*(?![\s*])([^*\n]+?)\*(?![*\w])/g, '$1<i>$2</i>');
  t = t.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + codes[+i] + '</code>');
  return t;
}

function mdList(block) {
  let html = '';
  const stack = [];
  block.forEach(l => {
    const m = l.match(/^(\s*)([-*]|\d+[.)])\s+(.*)$/);
    if (!m) { html += ' ' + mdInline(l.trim()); return; }
    const ind = m[1].length, tag = /\d/.test(m[2]) ? 'ol' : 'ul';
    const mn = /^\*\*Mnemonic:\*\*/.test(m[3]) ? ' class="md-mn"' : '';
    while (stack.length && ind < stack[stack.length - 1].ind) html += '</li></' + stack.pop().tag + '>';
    if (!stack.length || ind > stack[stack.length - 1].ind) {
      html += '<' + tag + '><li' + mn + '>' + mdInline(m[3]);
      stack.push({ ind, tag });
    } else {
      html += '</li><li' + mn + '>' + mdInline(m[3]);
    }
  });
  while (stack.length) html += '</li></' + stack.pop().tag + '>';
  return html;
}

function mdTable(rows) {
  const cells = r => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(/^\s*\|[\s:|-]+\|\s*$/.test(rows[1] || '') ? 2 : 1);
  return '<div class="md-table"><table><thead><tr>' + head.map(c => '<th>' + mdInline(c) + '</th>').join('') + '</tr></thead><tbody>'
    + body.map(r => '<tr>' + cells(r).map(c => '<td>' + mdInline(c) + '</td>').join('') + '</tr>').join('')
    + '</tbody></table></div>';
}

function mdRender(md) {
  const lines = String(md).split('\n');
  const out = [];
  const secLvl = lines.some(l => /^###\s/.test(l)) ? 3 : 2;
  let inSec = false;
  const closeSec = () => { if (inSec) { out.push('</div></details>'); inSec = false; } };
  const isList = l => /^\s*([-*]|\d+[.)])\s+/.test(l);
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim() || /^\s*---+\s*$/.test(l)) { i++; continue; }
    let m;
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) {
      let lvl = m[1].length, txt = m[2].trim().replace(/^\d{1,2}(\.\d{1,2})*\.?\s+(?=\D)/, '');
      if (state.curriculum && state.curriculum.subjects.some(s => s.name.toLowerCase() === txt.toLowerCase())) txt += ': core notes';
      if (lvl === 1) { /* file title: shown by the card */ }
      else if (lvl === 2 && secLvl === 3) { closeSec(); out.push('<div class="md-ctx">' + mdInline(txt) + '</div>'); }
      else if (lvl === secLvl) { closeSec(); out.push('<details class="md-sec"><summary>' + mdInline(txt) + '</summary><div class="md-body">'); inSec = true; }
      else out.push('<div class="md-h4">' + mdInline(txt) + '</div>');
      i++; continue;
    }
    if (/^\s*\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      out.push(mdTable(rows)); continue;
    }
    if (isList(l)) {
      const block = [];
      while (i < lines.length && lines[i].trim() && !/^#{1,6}\s/.test(lines[i]) && !/^\s*\|/.test(lines[i]) && (isList(lines[i]) || /^\s+\S/.test(lines[i]))) block.push(lines[i++]);
      out.push(mdList(block)); continue;
    }
    if (/^>\s?/.test(l)) {
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push('<blockquote class="md-quote">' + mdInline(q.join(' ')) + '</blockquote>'); continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^#{1,6}\s/.test(lines[i]) && !/^\s*\|/.test(lines[i]) && !isList(lines[i]) && !/^>\s?/.test(lines[i]) && !/^\s*---+\s*$/.test(lines[i])) para.push(lines[i++].trim());
    out.push('<p class="md-p">' + mdInline(para.join(' ')) + '</p>');
  }
  closeSec();
  return out.join('');
}

function fillTheoryNotes() {
  const N = window.__theoryNotes || {};
  document.querySelectorAll('#theory-vault-container .theory-notes').forEach(el => {
    if (el.getAttribute('data-filled')) return;
    const md = N[el.getAttribute('data-unit')];
    if (!md) return;
    const html = mdRender(md);
    const n = (html.match(/<details/g) || []).length;
    el.setAttribute('data-filled', '1');
    el.innerHTML = '<div class="theory-notes-head"><h6>' + (n ? n + ' sections' : 'Theory') + '</h6>'
      + (n ? '<span><button type="button" onclick="theoryNotesToggle(this,true)">Expand all</button><button type="button" onclick="theoryNotesToggle(this,false)">Collapse all</button></span>' : '')
      + '</div><div class="theory-notes-body">' + html + '</div>';
  });
}
function theoryNotesToggle(btn, open) {
  btn.closest('.theory-notes').querySelectorAll('details.md-sec').forEach(d => { d.open = open; });
}

function renderTheoryVault() {
  const pillsContainer = document.getElementById('theory-filter-pills');
  const contentContainer = document.getElementById('theory-vault-container');
  if (!pillsContainer || !contentContainer || !state.curriculum) return;

  pillsContainer.innerHTML = '';
  contentContainer.innerHTML = '';

  // Render subject pills
  theorySubjectList().forEach(subj => {
    const isAct = state.selectedTheorySubjectId === subj.subject_id;
    const btn = document.createElement('button');
    btn.className = `px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition flex items-center space-x-1.5 ${
      isAct ? 'bg-brand-600 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
    }`;
    btn.innerHTML = `
      <i data-lucide="${subj.icon || 'book'}" class="w-3.5 h-3.5"></i>
      <span>${subj.name}</span>
    `;
    btn.onclick = () => {
      state.selectedTheorySubjectId = subj.subject_id;
      state.selectedTheoryUnitId = null;
      renderTheoryVault();
    };
    pillsContainer.appendChild(btn);
  });

  const activeSubj = activeTheorySubject();
  if (!activeSubj) return;

  activeSubj.units.forEach(unit => {
    const theory = unit.quick_theory;
    const card = document.createElement('div');
    card.className = "bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 shadow-sm space-y-5";

    let tablesHtml = '';
    if (theory.core_tables) {
      theory.core_tables.forEach(tbl => {
        tablesHtml += `
          <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 overflow-x-auto">
            <h5 class="text-xs font-bold uppercase tracking-wider text-slate-800 mb-2">${thTitle(tbl)}</h5>
            <table class="w-full text-left text-xs">
              <thead class="border-b border-slate-200 text-slate-500 font-semibold">
                <tr>${tbl.headers.map(h => `<th class="py-1.5 px-2.5">${h}</th>`).join('')}</tr>
              </thead>
              <tbody class="divide-y divide-slate-100 text-slate-700">
                ${tbl.rows.map(r => `<tr>${r.map((c, i) => `<td class="py-2 px-2.5 ${i === 0 ? 'font-bold text-slate-900' : ''}">${c}</td>`).join('')}</tr>`).join('')}
              </tbody>
            </table>
          </div>
        `;
      });
    }

    let mnemonicsHtml = '';
    if (theory.high_yield_mnemonics) {
      mnemonicsHtml += `
        <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
          <h5 class="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center space-x-1">
            <i data-lucide="lightbulb" class="w-3.5 h-3.5 text-amber-600"></i>
            <span>Essential Mnemonics</span>
          </h5>
          <ul class="space-y-1.5 text-xs text-amber-950">
            ${theory.high_yield_mnemonics.map(m => `<li>${thMn(m)}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="flex items-center justify-between pb-3 border-b border-slate-100">
        <div>
          <span class="text-xs font-bold text-brand-600 uppercase tracking-wider">Unit ${unit.unit_number}</span>
          <h4 class="text-lg font-bold text-slate-900">${unit.title}</h4>
        </div>
        <button onclick="startUnitQuiz('${unit.unit_id}')" class="px-3.5 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1 shadow-sm">
          <span>Practice Unit</span>
          <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
        </button>
      </div>

      <div class="theory-notes" data-unit="${unit.unit_id}"><div class="theory-fallback space-y-5"><p class="text-xs sm:text-sm text-slate-600 leading-relaxed">${theory.summary}</p>${tablesHtml}${mnemonicsHtml}</div></div>
    `;

    if (unit.general) {
      const qb = card.querySelector('button[onclick^="startUnitQuiz"]'); if (qb) qb.remove();
      const lab = card.querySelector('span'); if (lab) lab.textContent = 'Reference';
    }
    contentContainer.appendChild(card);
  });

  buildTheoryToc(activeSubj);
  lucide.createIcons();
  loadTheoryNotes().then(() => {
    if (activeTheorySubject() !== activeSubj) return;
    fillTheoryNotes();
    buildTheoryToc(activeSubj);
    lucide.createIcons();
    filterTheorySearch();
  });
}

function thTitle(t) { return (t && (t.title || t.table_title)) || 'Key table'; }
function thMn(m, cls) {
  const c = cls ? ' class="' + cls + '"' : '';
  if (m && typeof m === 'object') return '<b' + c + '>' + m.name + ':</b> ' + m.expansion;
  const str = String(m);
  const i = str.indexOf(' = ');
  if (i > 0 && i < 60) return '<b' + c + '>' + str.slice(0, i) + '</b> = ' + str.slice(i + 3);
  return str;
}

function tocEsc(t) {
  return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildTheoryToc(subj) {
  const toc = document.getElementById('theory-toc');
  const cont = document.getElementById('theory-vault-container');
  if (!toc || !cont) return;
  const cards = Array.from(cont.children);
  const items = [];
  cards.forEach((card, i) => {
    const unit = subj.units[i];
    if (!unit) return;
    card.id = 'theory-unit-' + unit.unit_id;
    const subs = [];
    const summ = card.querySelector('p');
    if (summ) { summ.id = card.id + '-summary'; subs.push({ id: summ.id, label: 'Summary' }); }
    card.querySelectorAll('h5').forEach((h, j) => {
      const box = h.parentElement;
      const isMn = /mnemonic/i.test(h.textContent);
      box.id = card.id + (isMn ? '-mnemonics' : '-table-' + j);
      subs.push({ id: box.id, label: isMn ? 'Mnemonics' : h.textContent.trim() });
    });
    const nt = card.querySelector('.theory-notes[data-filled]');
    if (nt) {
      subs.length = 0;
      nt.querySelectorAll('.md-ctx, details.md-sec').forEach((d, k) => {
        d.id = card.id + '-sec-' + k;
        const isCtx = d.classList.contains('md-ctx');
        subs.push({ id: d.id, ctx: isCtx, label: (isCtx ? d.textContent : d.querySelector('summary').textContent || '').trim() });
      });
    }
    items.push({ unit, cardId: card.id, subs });
  });
  window.__theoryToc = items;
  let html = '<div class="theory-toc-head">Contents <span>' + tocEsc(subj.name) + '</span></div><ol class="theory-toc-list">';
  items.forEach(it => {
    html += '<li class="theory-toc-item" data-card="' + it.cardId + '">'
      + '<button type="button" class="theory-toc-unit" onclick="theoryTocGo(\'' + it.cardId + '\')">'
      + '<b>' + (it.unit.general ? 'Ref' : 'Unit ' + tocEsc(it.unit.unit_number)) + '</b><span>' + tocEsc(it.unit.title) + '</span></button>'
      + '<ul class="theory-toc-subs">'
      + it.subs.map(x => '<li' + (x.ctx ? ' class="toc-ctx"' : '') + '><button type="button" onclick="theoryTocGo(\'' + x.id + '\')">' + tocEsc(x.label) + '</button></li>').join('')
      + '</ul></li>';
  });
  html += '</ol>';
  toc.innerHTML = html;
  if (!window.__theoryTocBound) {
    window.__theoryTocBound = true;
    let tick = false;
    window.addEventListener('scroll', () => {
      if (tick) return; tick = true;
      requestAnimationFrame(() => { tick = false; theoryTocHighlight(); });
    }, { passive: true });
  }
  theoryTocHighlight();
}

function theoryTocGo(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.tagName === 'DETAILS') el.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function theoryTocHighlight() {
  const items = window.__theoryToc;
  const view = document.getElementById('view-theory');
  if (!items || !items.length || !view || view.classList.contains('hidden')) return;
  let cur = items[0].cardId;
  items.forEach(it => {
    const el = document.getElementById(it.cardId);
    if (el && el.style.display !== 'none' && el.getBoundingClientRect().top <= 140) cur = it.cardId;
  });
  document.querySelectorAll('#theory-toc .theory-toc-item').forEach(li => {
    const on = li.getAttribute('data-card') === cur;
    if (on !== li.classList.contains('active')) {
      li.classList.toggle('active', on);
      if (on) {
        const btn = li.querySelector('.theory-toc-unit');
        const bar = document.getElementById('theory-toc');
        if (btn && bar && bar.scrollWidth > bar.clientWidth + 2) bar.scrollTo({ left: btn.offsetLeft - 40, behavior: 'smooth' });
      }
    }
  });
}

function filterTheorySearch() {
  const query = (document.getElementById('theory-search')?.value || '').toLowerCase().trim();
  const cards = document.querySelectorAll('#theory-vault-container > div');
  document.querySelectorAll('#theory-vault-container details.md-sec').forEach(d => { if (query) d.open = d.textContent.toLowerCase().includes(query); });
  cards.forEach(c => {
    const text = c.textContent.toLowerCase();
    c.style.display = text.includes(query) ? '' : 'none';
    const li = document.querySelector('#theory-toc .theory-toc-item[data-card="' + c.id + '"]');
    if (li) li.style.display = text.includes(query) ? '' : 'none';
  });
}

// -------------------------------------------------------------
// SYNC & BACKUP MODAL
// -------------------------------------------------------------
function toggleSyncModal() {
  const modal = document.getElementById('sync-modal');
  modal.classList.toggle('hidden');
  if (!modal.classList.contains('hidden')) {
    document.getElementById('sync-textarea').value = JSON.stringify(state.userData);
  }
}

function exportSyncCode() {
  const code = JSON.stringify(state.userData);
  navigator.clipboard.writeText(code).then(() => {
    alert("Backup code copied to clipboard! You can paste this on any other phone or device to restore progress.");
  }).catch(() => {
    alert("Please copy the text from the backup box.");
  });
}

function importSyncCode() {
  const raw = document.getElementById('sync-textarea').value.trim();
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state.userData = parsed;
    ['practice', 'mistakes', 'srs', 'why'].forEach(k => { if (!state.userData[k] || typeof state.userData[k] !== 'object') state.userData[k] = {}; });
    if (!Array.isArray(state.userData.history)) state.userData.history = [];
    saveUserData();
    toggleSyncModal();
    alert("Progress restored successfully!");
    renderSubjectsGrid();
  } catch (e) {
    alert("Invalid backup code format.");
  }
}

// -------------------------------------------------------------
// FLOATING ACTION BUTTON (FAB) & QUICK MENU
// -------------------------------------------------------------
function toggleFabMenu() {
  const popover = document.getElementById('fab-menu-popover');
  const icon = document.getElementById('fab-icon');
  if (!popover) return;
  const isHidden = popover.classList.contains('hidden');
  if (isHidden) {
    popover.classList.remove('hidden');
    if (typeof dtRefreshLight === 'function') dtRefreshLight();
    if (icon) icon.setAttribute('data-lucide', 'x');
  } else {
    popover.classList.add('hidden');
    if (icon) icon.setAttribute('data-lucide', 'sliders');
  }
  if (window.lucide) lucide.createIcons();
}

document.addEventListener('click', (e) => {
  const container = document.getElementById('fab-container');
  const popover = document.getElementById('fab-menu-popover');
  if (container && popover && e.target.isConnected && !container.contains(e.target) && !popover.classList.contains('hidden')) {
    popover.classList.add('hidden');
    const icon = document.getElementById('fab-icon');
    if (icon) {
      icon.setAttribute('data-lucide', 'sliders');
      if (window.lucide) lucide.createIcons();
    }
  }
});


// -------------------------------------------------------------
// ADVANCED PEDAGOGY (step 1): answer log, settings, "why did I miss this"
// -------------------------------------------------------------
const PG_WRONG = [['DK', "I didn't know this"], ['MISREAD', 'I misread the question'], ['BUZZ', 'I jumped on a buzzword / stopped early'], ['CHANGED', 'I changed from the right answer'], ['SURE', 'I was sure, but wrong']];
const PG_RIGHT = [['KNEW', 'I knew it'], ['PART', 'I narrowed it down'], ['GUESS', 'I guessed']];
const PG_LABEL = {};
PG_WRONG.concat(PG_RIGHT).forEach(p => { PG_LABEL[p[0]] = p[1]; });

function pgS() { return state._pg || (state._pg = { att: {}, done: {} }); }
function pgEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
function pgSettings() { try { return JSON.parse(localStorage.getItem('MEDAIDE_SETTINGS_V1') || '{}') || {}; } catch (e) { return {}; } }
function pgOn() { const s = pgSettings(); return s.pedagogy === undefined ? true : !!s.pedagogy; }
function pgSetOn(v) {
  const s = pgSettings(); s.pedagogy = !!v;
  try { localStorage.setItem('MEDAIDE_SETTINGS_V1', JSON.stringify(s)); } catch (e) {}
}

// ---- answer log (IndexedDB; falls back to memory if the browser blocks it) ----
const ALOG = { db: null, mem: [], ready: null };
function alogOpen() {
  if (ALOG.ready) return ALOG.ready;
  ALOG.ready = new Promise(res => {
    try {
      const rq = indexedDB.open('medaide_log', 1);
      rq.onupgradeneeded = () => {
        const st = rq.result.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true });
        st.createIndex('qid', 'qid'); st.createIndex('ts', 'ts');
      };
      rq.onsuccess = () => { ALOG.db = rq.result; res(ALOG.db); };
      rq.onerror = () => res(null);
      rq.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
  return ALOG.ready;
}
function alogAdd(rec) {
  return alogOpen().then(db => new Promise(res => {
    if (!db) { rec.id = ALOG.mem.length + 1; ALOG.mem.push(rec); return res(rec.id); }
    try {
      const rq = db.transaction('attempts', 'readwrite').objectStore('attempts').add(rec);
      rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null);
    } catch (e) { res(null); }
  }));
}
function alogUpdate(id, patch) {
  if (id == null) return Promise.resolve();
  return alogOpen().then(db => new Promise(res => {
    if (!db) { const r = ALOG.mem.find(x => x.id === id); if (r) Object.assign(r, patch); return res(); }
    try {
      const st = db.transaction('attempts', 'readwrite').objectStore('attempts');
      const g = st.get(id);
      g.onsuccess = () => { if (g.result) st.put(Object.assign(g.result, patch)); res(); };
      g.onerror = () => res();
    } catch (e) { res(); }
  }));
}
function alogAll() {
  return alogOpen().then(db => new Promise(res => {
    if (!db) return res(ALOG.mem.slice());
    try {
      const rq = db.transaction('attempts', 'readonly').objectStore('attempts').getAll();
      rq.onsuccess = () => res(rq.result || []); rq.onerror = () => res([]);
    } catch (e) { res([]); }
  }));
}
function pgLog(q, chosen, ok, mode) {
  try {
    const timed = mode === 'PRACTICE' || mode === 'RAPID_FIRE';
    const sid = q.subject_id || (state.activeSubject ? state.activeSubject.subject_id : 'GENERAL');
    const rec = { qid: q.id, ts: Date.now(), mode: mode, chosen: chosen, correct: !!ok,
      ms: timed && state._qShownAt ? Date.now() - state._qShownAt : (mode === 'GRAND_TEST' && state.gtTimes && state.gtTimes[q.id] ? Math.round(state.gtTimes[q.id]) : null),
      subject: sid, qtype: q.question_type || null, why: null, v: 1 };
    if (state.dtCtx && mode === 'RAPID_FIRE') { rec.daily = state.dtCtx.day; rec.part = state.dtCtx.part[q.id] || null; if (state.dtCtx.cu) rec.cu = 1; }
    pgS().att[q.id] = alogAdd(rec);
    if (rec.daily) Promise.resolve(pgS().att[q.id]).then(() => dtRefreshLight(true));
  } catch (e) { console.error('answer log', e); }
}

// ---- "why did I miss this" ----
function pgWhyHtml(q, ok) {
  const done = pgS().done[q.id];
  const opts = ok ? PG_RIGHT : PG_WRONG;
  let h = '<div class="pg-why mt-3 pt-3 border-t border-slate-200/70 space-y-1.5" data-q="' + pgEsc(q.id) + '" data-ok="' + (ok ? 1 : 0) + '">';
  if (done) {
    h += '<div class="text-[11px] text-slate-600">Noted: <b>' + pgEsc(PG_LABEL[done] || done) + '</b> <button type="button" data-pg-change="1" class="underline text-slate-500 hover:text-slate-800 ml-1">change</button></div></div>';
    return h;
  }
  h += '<div class="text-[11px] font-bold text-slate-600">' + (ok ? 'How sure were you? (optional)' : 'Why did you miss this? (optional)') + '</div><div class="flex flex-wrap gap-1.5">';
  opts.forEach(p => {
    h += '<button type="button" data-pg-why="' + p[0] + '" class="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700">' + pgEsc(p[1]) + '</button>';
  });
  return h + '</div></div>';
}
function pgAttachWhy(box, q, ok) {
  if (!box || !q || !pgOn()) return;
  const d = document.createElement('div');
  d.innerHTML = pgWhyHtml(q, ok);
  box.appendChild(d.firstChild);
}
function pgAttachWhyReview(card, q, ok) {
  if (!pgOn() || !state.userAnswers[q.id]) return;
  const d = document.createElement('div');
  d.innerHTML = pgWhyHtml(q, ok);
  card.appendChild(d.firstChild);
}
function pgSetWhy(qid, key) {
  const rec = { r: key, d: new Date().toISOString() };
  if (!state.userData.why) state.userData.why = {};
  state.userData.why[qid] = rec;
  pgS().done[qid] = key;
  saveUserData();
  Promise.resolve(pgS().att[qid]).then(id => alogUpdate(id, { why: key }));
}
function pgWhyLine(qid) {
  const w = state.userData.why && state.userData.why[qid];
  if (!w) return '';
  return '<div class="text-[11px] text-slate-600 pt-1">Why you missed it: <b>' + pgEsc(PG_LABEL[w.r] || w.r) + '</b></div>';
}
document.addEventListener('click', (e) => {
  const t = e.target.closest ? e.target.closest('[data-pg-why],[data-pg-change]') : null;
  if (!t) return;
  const wrap = t.closest('.pg-why');
  if (!wrap) return;
  const qid = wrap.getAttribute('data-q');
  const ok = wrap.getAttribute('data-ok') === '1';
  if (t.hasAttribute('data-pg-change')) {
    delete pgS().done[qid];
    const q = findQuestionById(qid) || { id: qid };
    const d = document.createElement('div'); d.innerHTML = pgWhyHtml(q, ok);
    wrap.replaceWith(d.firstChild);
    return;
  }
  pgSetWhy(qid, t.getAttribute('data-pg-why'));
  const q = findQuestionById(qid) || { id: qid };
  const d = document.createElement('div'); d.innerHTML = pgWhyHtml(q, ok);
  wrap.replaceWith(d.firstChild);
});

// ---- settings panel ----
function toggleSettingsModal() {
  const m = document.getElementById('settings-modal');
  if (!m) return;
  m.classList.toggle('hidden');
  if (!m.classList.contains('hidden')) {
    const cb = document.getElementById('pg-toggle'); if (cb) cb.checked = pgOn();
    rvRenderSettings();
    srsRenderSettings();
    pwaRenderSettings();
    alogAll().then(a => { const el = document.getElementById('pg-log-count'); if (el) el.textContent = a.length; });
  }
}
function pgToggleChanged(cb) { pgSetOn(cb.checked); }
function downloadAnswerLog() {
  alogAll().then(a => {
    const blob = new Blob([JSON.stringify({ app: 'MedPrepAide', kind: 'answer-log', version: 1, exported: new Date().toISOString(), attempts: a })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const l = document.createElement('a');
    l.href = url; l.download = 'medprepaide-answer-log-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(l); l.click(); l.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
}
function importAnswerLog(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const obj = JSON.parse(r.result);
      const arr = Array.isArray(obj) ? obj : obj.attempts;
      if (!Array.isArray(arr)) throw new Error('bad');
      alogAll().then(existing => {
        const seen = new Set(existing.map(x => x.qid + '|' + x.ts));
        const adds = [];
        arr.forEach(x => { if (x && x.qid && x.ts && !seen.has(x.qid + '|' + x.ts)) { const c = Object.assign({}, x); delete c.id; adds.push(alogAdd(c)); } });
        Promise.all(adds).then(() => { alert('Restored ' + adds.length + ' answers.'); toggleSettingsModal(); });
      });
    } catch (e) { alert('That file is not a MedPrepAide answer log.'); }
    input.value = '';
  };
  r.readAsText(f);
}
alogOpen();


// -------------------------------------------------------------
// STRENGTH RATINGS (pedagogy step 2)
// Every number is recomputed from the answer log, so changing the rules or the topic list never loses history.
// -------------------------------------------------------------
const ST_CFG = {
  halfLifeDays: 30,          // an answer's weight halves every 30 days
  priorWeight: 3,            // the starting estimate counts like 3 answers
  defaultPrior: 50,          // used when the survey was skipped
  repeatWindowDays: 3, repeatWeight: 0.3,   // same question again within 3 days counts 0.3
  mode: { PRACTICE: 1, GRAND_TEST: 1, SRS: 0.8, RAPID_FIRE: 0.7, SEED: 0.5 },
  extremeRight: 1.3, extremeWrong: 0.7,
  why: { GUESS: { y: 0.5 }, MISREAD: { w: 0.5 }, CHANGED: { w: 0.7 }, SURE: { w: 1.2 } },
  conf: [5, 15],             // evidence below 5 = low, 5-15 = medium, above 15 = high
  bands: [50, 70, 85],       // Weak < 50 <= Developing < 70 <= Strong < 85 <= Mastered
  masteryDays: 2,            // Mastered also needs right answers on 2 different days and at least medium confidence
  survey: [['VW', 'Very weak', 30], ['W', 'Weak', 45], ['A', 'Average', 60], ['G', 'Good', 72], ['VS', 'Very strong', 85]]
};
const ST_BANDS = {
  'Not started': 'bg-slate-100 text-slate-600 border-slate-200',
  'Weak': 'bg-rose-50 text-rose-700 border-rose-200',
  'Developing': 'bg-amber-50 text-amber-700 border-amber-200',
  'Strong': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Mastered': 'bg-indigo-50 text-indigo-700 border-indigo-200'
};
const ST_BAR = { 'Not started': 'bg-slate-300', 'Weak': 'bg-rose-500', 'Developing': 'bg-amber-500', 'Strong': 'bg-emerald-500', 'Mastered': 'bg-indigo-600' };
const ST = { loading: null, open: {}, showHelp: false, showSurvey: false, last: null };

function stEnsureTopics() {
  if (window.TOPIC_DATA) return Promise.resolve(window.TOPIC_DATA);
  if (ST.loading) return ST.loading;
  ST.loading = new Promise(res => {
    const s = document.createElement('script');
    s.src = 'data/topics.js?v=20261118i';
    s.onload = () => res(window.TOPIC_DATA || null);
    s.onerror = () => { ST.loading = null; res(null); };
    document.head.appendChild(s);
  });
  return ST.loading;
}
function stIndex(T) {
  if (T._ix) return T._ix;
  const byTopic = T.topics.map(() => []);
  Object.keys(T.q).forEach(qid => { byTopic[T.q[qid][1]].push(qid); });
  return (T._ix = { byTopic });
}
function stSurveyValue(code) { const b = ST_CFG.survey.find(x => x[0] === code); return b ? b[2] : null; }
function stPrior(sid) {
  const c = state.userData.confidence || {};
  const v = stSurveyValue(c[sid]);
  return v == null ? ST_CFG.defaultPrior : v;
}
function stBand(node) {
  if (!node.attempts) return 'Not started';
  const b = ST_CFG.bands;
  if (node.p < b[0]) return 'Weak';
  if (node.p < b[1]) return 'Developing';
  if (node.p < b[2]) return 'Strong';
  return (node.nEff >= ST_CFG.conf[0] && node.days >= ST_CFG.masteryDays) ? 'Mastered' : 'Strong';
}
function stConf(nEff) { return nEff < ST_CFG.conf[0] ? 'low' : nEff <= ST_CFG.conf[1] ? 'medium' : 'high'; }

// Answers before the answer log existed (last result only) count as low-weight "seed" evidence.
function stSeeds(log) {
  const logged = new Set(log.map(r => r.qid));
  const out = [];
  const pr = state.userData.practice || {};
  Object.keys(pr).forEach(qid => {
    if (logged.has(qid)) return;
    const t = Date.parse(pr[qid].d); if (!t) return;
    out.push({ qid, ts: t, mode: 'SEED', correct: pr[qid].r === 'C', qtype: null, why: null });
    logged.add(qid);
  });
  const mi = state.userData.mistakes || {};
  Object.keys(mi).forEach(qid => {
    if (logged.has(qid)) return;
    const t = Date.parse(mi[qid].lastWrongDate); if (!t) return;
    out.push({ qid, ts: t, mode: 'SEED', correct: false, qtype: (mi[qid].q || {}).question_type || null, why: null });
  });
  return out;
}

// One answer -> [weight, score]
function stWeigh(r, now, lastSeen) {
  const age = Math.max(0, (now - r.ts) / 864e5);
  let w = Math.pow(0.5, age / ST_CFG.halfLifeDays) * (ST_CFG.mode[r.mode] != null ? ST_CFG.mode[r.mode] : 1);
  let y = r.correct ? 1 : 0;
  if (lastSeen != null && (r.ts - lastSeen) < ST_CFG.repeatWindowDays * 864e5) w *= ST_CFG.repeatWeight;
  if (r.qtype === 'EXTREME') w *= r.correct ? ST_CFG.extremeRight : ST_CFG.extremeWrong;
  const wy = r.why && ST_CFG.why[r.why];
  if (wy) {
    if (wy.y != null && r.correct) y = wy.y;
    if (wy.w != null && !r.correct) w *= wy.w;
  }
  return [w, y];
}

async function stCompute(opts) {
  opts = opts || {};
  const T = await stEnsureTopics();
  if (!T) return null;
  const log = opts.log || await alogAll();
  const now = opts.now || Date.now();
  const all = log.concat(stSeeds(log)).filter(r => r && r.qid && r.ts).sort((a, b) => a.ts - b.ts);
  const acc = {};
  const get = k => acc[k] || (acc[k] = { sw: 0, swy: 0, attempts: 0, qs: new Set(), daysRight: new Set(), last: 0 });
  const lastSeen = {}, lastResult = {};
  all.forEach(r => {
    const m = T.q[r.qid];
    let sid, tKey = null, uKey = null, aKey = null;
    if (m) {
      const t = T.topics[m[1]]; sid = t[1];
      tKey = 'T:' + t[0]; uKey = 'U:' + sid + ':' + t[2]; aKey = 'A:' + T.appUnits[m[0]][0];
    } else sid = r.subject;
    if (!sid) return;
    const [w, y] = stWeigh(r, now, lastSeen[r.qid]);
    lastSeen[r.qid] = r.ts; lastResult[r.qid] = { ok: !!r.correct, ts: r.ts };
    const day = new Date(r.ts).toISOString().slice(0, 10);
    ['S:' + sid, uKey, tKey, aKey].forEach(k => {
      if (!k) return;
      const a = get(k);
      a.sw += w; a.swy += w * y; a.attempts++; a.qs.add(r.qid); a.last = Math.max(a.last, r.ts);
      if (r.correct) a.daysRight.add(day);
    });
  });
  const node = (k, priorP, total) => {
    const a = acc[k] || { sw: 0, swy: 0, attempts: 0, qs: new Set(), daysRight: new Set(), last: 0 };
    const k0 = ST_CFG.priorWeight;
    const p = 100 * (k0 * priorP / 100 + a.swy) / (k0 + a.sw);
    const n = { p: Math.round(p * 10) / 10, pr: p, prior: priorP, nEff: Math.round(a.sw * 10) / 10, conf: stConf(a.sw),
      attempts: a.attempts, seen: a.qs.size, total: total, coverage: total ? a.qs.size / total : 0,
      days: a.daysRight.size, last: a.last || null };
    n.band = stBand(n);
    return n;
  };
  const ix = stIndex(T);
  const subjects = (state.curriculum && state.curriculum.subjects) || [];
  const tree = subjects.map(s => {
    const sid = s.subject_id;
    const tps = T.topics.map((t, i) => ({ t, i })).filter(x => x.t[1] === sid);
    const totalS = tps.reduce((n, x) => n + ix.byTopic[x.i].length, 0);
    const S = node('S:' + sid, stPrior(sid), totalS);
    S.id = sid; S.name = s.name; S.surveyed = !!(state.userData.confidence || {})[sid];
    const unitCodes = Object.keys((T.units || {})[sid] || {});
    tps.forEach(x => { if (unitCodes.indexOf(x.t[2]) < 0) unitCodes.push(x.t[2]); });
    S.units = unitCodes.map(code => {
      const ut = tps.filter(x => x.t[2] === code);
      if (!ut.length) return null;
      const U = node('U:' + sid + ':' + code, S.pr, ut.reduce((n, x) => n + ix.byTopic[x.i].length, 0));
      U.code = code; U.name = ((T.units || {})[sid] || {})[code] || code;
      U.topics = ut.map(x => { const N = node('T:' + x.t[0], U.pr, ix.byTopic[x.i].length); N.id = x.t[0]; N.name = x.t[3]; N.ti = x.i; return N; });
      U.topicsStarted = U.topics.filter(t => t.attempts).length;
      return U;
    }).filter(Boolean);
    S.topicsTotal = tps.length; S.topicsStarted = S.units.reduce((n, u) => n + u.topicsStarted, 0);
    S.appUnits = (s.units || []).map(u => { const N = node('A:' + u.unit_id, S.pr, u.total_questions || 0); N.id = u.unit_id; N.name = u.title; return N; });
    return S;
  });
  const res = { computedAt: now, answers: all.length, version: T.version, subjects: tree, lastResult: lastResult };
  ST.last = res;
  return res;
}

// ---- revision picker (used by Revision GT, Revision drill and the Daily Target) ----
// opts: { count, mix: {W,D,N,S,M} (relative weights per band), subjects: [ids] or null, types: [0,1,2] or null,
//         avoidCorrectDays: 7, includeUnsorted: false }
// Topics are grouped by band (Weak, Developing, Not started, Strong, Mastered); the test is split across bands by the mix.
// Empty bands hand their share to the others. Inside Weak/Developing, weaker topics are picked more often.
const RV_DEFAULT_MIX = { W: 40, D: 30, N: 15, S: 10, M: 5 };
const RV_BANDKEY = { 'Weak': 'W', 'Developing': 'D', 'Not started': 'N', 'Strong': 'S', 'Mastered': 'M' };
function rvPrefs() {
  const p = state.userData.revPrefs || {};
  return { mix: Object.assign({}, RV_DEFAULT_MIX, p.mix || {}), customCount: p.customCount || 50,
    customMinPerQ: p.customMinPerQ || 1.05, customSubjects: Array.isArray(p.customSubjects) && p.customSubjects.length ? p.customSubjects : null };
}
async function stPickRevision(opts) {
  opts = Object.assign({ count: 50, mix: null, subjects: null, types: null, avoidCorrectDays: 7, includeUnsorted: false, exclude: null }, opts || {});
  const mix = opts.mix || rvPrefs().mix;
  const R = await stCompute();
  if (!R) return [];
  const T = window.TOPIC_DATA, ix = stIndex(T), now = Date.now();
  const pools = { W: [], D: [], N: [], S: [], M: [] };
  R.subjects.forEach(s => {
    if (opts.subjects && opts.subjects.indexOf(s.id) < 0) return;
    s.units.forEach(u => u.topics.forEach(t => {
      if (t.total && (opts.includeUnsorted || !/-UNSORTED$/.test(t.id))) pools[RV_BANDKEY[t.band]].push(t);
    }));
  });
  const used = new Set(opts.exclude || []);
  const okQ = q => {
    if (used.has(q)) return false;
    if (opts.types && opts.types.indexOf(T.q[q][2]) < 0) return false;
    const lr = R.lastResult[q];
    return !(lr && lr.ok && now - lr.ts < opts.avoidCorrectDays * 864e5);
  };
  const pickFrom = (pool, n, weakSide) => {
    pool = pool.slice(); const out = [];
    let guard = n * 30;
    while (out.length < n && pool.length && guard-- > 0) {
      const ws = pool.map(t => (weakSide ? (1 - t.p / 100) + 0.05 : 1) * Math.sqrt(t.total));
      let r = Math.random() * ws.reduce((a, b) => a + b, 0), i = 0;
      while (r > ws[i] && i < ws.length - 1) { r -= ws[i]; i++; }
      const cand = ix.byTopic[pool[i].ti].filter(okQ);
      if (!cand.length) { pool.splice(i, 1); continue; }
      const wrong = cand.filter(q => R.lastResult[q] && !R.lastResult[q].ok);
      const unseen = cand.filter(q => !R.lastResult[q]);
      const src = wrong.length && Math.random() < 0.5 ? wrong : unseen.length ? unseen : cand;
      const q = src[Math.floor(Math.random() * src.length)];
      used.add(q); out.push(q);
    }
    return out;
  };
  // split the count across non-empty bands by the mix (largest remainder)
  const keys = Object.keys(pools).filter(k => pools[k].length && (mix[k] || 0) > 0);
  const tot = keys.reduce((n, k) => n + mix[k], 0);
  let picked = [];
  if (tot > 0) {
    const raw = keys.map(k => [k, opts.count * mix[k] / tot]);
    const alloc = {}; let given = 0;
    raw.forEach(([k, v]) => { alloc[k] = Math.floor(v); given += alloc[k]; });
    raw.sort((a, b) => (b[1] % 1) - (a[1] % 1)).forEach(([k]) => { if (given < opts.count) { alloc[k]++; given++; } });
    keys.forEach(k => { picked = picked.concat(pickFrom(pools[k], alloc[k], k === 'W' || k === 'D')); });
  }
  // top up from any band if some bands ran dry
  ['W', 'D', 'N', 'S', 'M'].forEach(k => { if (picked.length < opts.count) picked = picked.concat(pickFrom(pools[k], opts.count - picked.length, k === 'W' || k === 'D')); });
  return shuffleArray(picked);
}

// ---- starting-confidence survey ----
function stSetConfidence(sid, code) {
  if (!state.userData.confidence || typeof state.userData.confidence !== 'object') state.userData.confidence = {};
  state.userData.confidence[sid] = code;
  state.userData.confidenceDate = new Date().toISOString();
  saveUserData();
  renderStrengthsView();
}
function stSkipSurvey() {
  if (!state.userData.confidence || typeof state.userData.confidence !== 'object') state.userData.confidence = {};
  state.userData.confidence._skipped = new Date().toISOString();
  ST.showSurvey = false; saveUserData(); renderStrengthsView();
}
function stToggle(k) { ST.open[k] = !ST.open[k]; renderStrengthsView(); }
function stToggleHelp() { ST.showHelp = !ST.showHelp; renderStrengthsView(); }
function stToggleSurvey() { ST.showSurvey = !ST.showSurvey; renderStrengthsView(); }

function stChip(n) {
  return '<span class="inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold ' + ST_BANDS[n.band] + '">' + n.band + '</span>';
}
function stBarHtml(n) {
  return '<div class="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden"><div class="h-full ' + ST_BAR[n.band] + '" style="width:' + Math.max(2, Math.min(100, n.p)) + '%"></div></div>';
}
function stMeta(n) {
  if (!n.attempts) return 'No answers yet · starting estimate';
  return n.seen + ' of ' + n.total + ' questions seen · ' + n.attempts + ' answers · ' + n.conf + ' confidence';
}
function stSurveyHtml(subjects) {
  const c = state.userData.confidence || {};
  let h = '<div class="bg-white border border-indigo-200 rounded-2xl p-4 sm:p-5 space-y-3">' +
    '<div><div class="font-bold text-slate-900 text-sm">How confident are you in each subject?</div>' +
    '<p class="text-xs text-slate-500 mt-1 leading-relaxed">This sets your starting point. Your answers take over as you practise; you can change this any time.</p></div><div class="space-y-2.5">';
  subjects.forEach(s => {
    h += '<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5"><div class="text-xs font-semibold text-slate-800">' + pgEsc(s.name) + '</div><div class="flex flex-wrap gap-1">';
    ST_CFG.survey.forEach(b => {
      const on = c[s.id] === b[0];
      h += '<button type="button" onclick="stSetConfidence(\'' + s.id + '\',\'' + b[0] + '\')" class="px-2 py-1 rounded-lg border text-[11px] font-semibold ' +
        (on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100') + '">' + b[1] + '</button>';
    });
    h += '</div></div>';
  });
  h += '</div><div class="flex justify-end gap-2 pt-1"><button type="button" onclick="stSkipSurvey()" class="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-100">Done</button></div></div>';
  return h;
}
function stHelpHtml() {
  const c = ST_CFG, sv = c.survey.map(b => b[1] + ' ' + b[2] + '%').join(', ');
  return '<div class="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 text-xs text-slate-700 leading-relaxed space-y-2.5">' +
    '<div class="font-bold text-slate-900 text-sm">How your strength number is calculated</div>' +
    '<p><b>Strength</b> is your estimated chance of getting a question right in that subject, unit or topic, from 0 to 100. It is worked out on this device from every answer you have given, every time you open this page.</p>' +
    '<p><b>Starting point.</b> Before you answer anything, each subject starts from your survey choice (' + sv + '; ' + c.defaultPrior + '% if you skipped it). This starting point counts as much as ' + c.priorWeight + ' answers, so real answers soon outweigh it. A unit starts from its subject\'s strength and a topic from its unit\'s.</p>' +
    '<p><b>Formula.</b> Strength = (' + c.priorWeight + ' × starting point + weighted right answers) ÷ (' + c.priorWeight + ' + weighted answers).</p>' +
    '<p><b>How much each answer counts:</b></p><ul class="list-disc pl-5 space-y-1">' +
    '<li>Recent answers count more: an answer\'s weight halves every ' + c.halfLifeDays + ' days.</li>' +
    '<li>Practice and Grand Tests count fully; Spaced Review ' + c.mode.SRS + '; Rapid Fire ' + c.mode.RAPID_FIRE + '; answers saved before the answer log existed ' + c.mode.SEED + '.</li>' +
    '<li>Seeing the same question again within ' + c.repeatWindowDays + ' days counts only ' + c.repeatWeight + ' (you may remember the answer).</li>' +
    '<li>Extreme questions: right counts ' + c.extremeRight + ', wrong counts ' + c.extremeWrong + '.</li>' +
    '<li>If you use "Why did I miss this": a right answer you guessed counts as half right; a wrong answer from misreading counts ' + c.why.MISREAD.w + ', from changing the right answer ' + c.why.CHANGED.w + ', and "sure but wrong" counts ' + c.why.SURE.w + '.</li></ul>' +
    '<p><b>Bands:</b> Weak below ' + c.bands[0] + ', Developing ' + c.bands[0] + '–' + c.bands[1] + ', Strong ' + c.bands[1] + '–' + c.bands[2] + ', Mastered ' + c.bands[2] + ' and above (Mastered also needs at least medium confidence and right answers on ' + c.masteryDays + ' different days).</p>' +
    '<p><b>Confidence</b> shows how much evidence there is: low under ' + c.conf[0] + ' weighted answers, medium ' + c.conf[0] + '–' + c.conf[1] + ', high above ' + c.conf[1] + '. <b>Coverage</b> is how many of that topic\'s questions you have seen.</p>' +
    '<p class="text-slate-500">Topics are provisional (based on standard textbooks) until the faculty review is finished. Your history is kept, so numbers will simply be recalculated when the topic list changes.</p></div>';
}
async function renderStrengthsView() {
  const box = document.getElementById('strengths-container');
  if (!box) return;
  if (!state.userData.plan && !state.userData.planSkipped && !ST._autoSurvey) { ST._autoSurvey = true; setTimeout(planOpen, 0); }
  box.innerHTML = '<div class="text-sm text-slate-500 p-4">Working out your strengths…</div>';
  const R = await stCompute();
  if (!R) { box.innerHTML = '<div class="text-sm text-rose-600 p-4">Could not load the topic list. Check your connection and try again.</div>'; return; }
  let h = '<div class="flex flex-wrap gap-2">' +
    '<button type="button" onclick="stToggleSurvey()" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100">Starting confidence survey</button>' +
    '<button type="button" onclick="stToggleHelp()" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100">How is this calculated?</button>' +
    '<span class="text-[11px] text-slate-500 self-center">' + R.answers + ' answers used</span></div>';
  if (ST.showSurvey) h += stSurveyHtml(R.subjects);
  if (ST.showHelp) h += stHelpHtml();
  h += '<div class="grid grid-cols-1 lg:grid-cols-2 gap-3">';
  R.subjects.forEach(s => {
    const k = 'S:' + s.id;
    h += '<div class="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">' +
      '<button type="button" onclick="stToggle(\'' + k + '\')" class="w-full text-left space-y-2">' +
      '<div class="flex items-center justify-between gap-3"><div class="min-w-0"><div class="font-bold text-slate-900 text-sm truncate">' + pgEsc(s.name) + '</div>' +
      '<div class="text-[11px] text-slate-500">' + stMeta(s) + ' · ' + s.topicsStarted + '/' + s.topicsTotal + ' topics started</div></div>' +
      '<div class="text-right shrink-0"><div class="text-xl font-extrabold text-slate-900">' + Math.round(s.p) + '</div>' + stChip(s) + '</div></div>' + stBarHtml(s) + '</button>';
    if (ST.open[k]) {
      h += '<div class="pt-2 space-y-2 border-t border-slate-100">';
      s.units.forEach(u => {
        const uk = 'U:' + s.id + ':' + u.code;
        h += '<div class="rounded-xl bg-slate-50 border border-slate-200 p-3"><button type="button" onclick="stToggle(\'' + uk + '\')" class="w-full text-left space-y-1.5">' +
          '<div class="flex items-center justify-between gap-3"><div class="min-w-0"><div class="text-xs font-bold text-slate-800">' + pgEsc(u.name) + '</div>' +
          '<div class="text-[10px] text-slate-500">' + stMeta(u) + ' · ' + u.topicsStarted + '/' + u.topics.length + ' topics started</div></div>' +
          '<div class="text-right shrink-0"><div class="text-base font-extrabold text-slate-800">' + Math.round(u.p) + '</div>' + stChip(u) + '</div></div>' + stBarHtml(u) + '</button>';
        if (ST.open[uk]) {
          h += '<div class="mt-2 space-y-1.5">';
          u.topics.forEach(t => {
            h += '<div class="bg-white rounded-lg border border-slate-200 p-2.5 space-y-1"><div class="flex items-center justify-between gap-3"><div class="min-w-0">' +
              '<div class="text-[11px] font-semibold text-slate-800">' + pgEsc(t.name) + '</div><div class="text-[10px] text-slate-500">' + stMeta(t) + '</div></div>' +
              '<div class="text-right shrink-0"><div class="text-sm font-extrabold text-slate-800">' + Math.round(t.p) + '</div>' + stChip(t) + '</div></div>' + stBarHtml(t) + '</div>';
          });
          h += '</div>';
        }
        h += '</div>';
      });
      h += '</div>';
    }
    h += '</div>';
  });
  h += '</div>';
  box.innerHTML = h;
}


// -------------------------------------------------------------
// STUDY PLAN, DAILY TARGET, REVISION TESTS (pedagogy step 3)
// -------------------------------------------------------------
const PL_DAY = 864e5;
function plDayKey(d) { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }
function plParse(k) { const p = String(k).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function plDaysBetween(a, b) { return Math.round((plParse(b) - plParse(a)) / PL_DAY); }
function plAddDays(k, n) { const d = plParse(k); d.setDate(d.getDate() + n); return plDayKey(d); }
function plFmt(k) { return plParse(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
function plMonthsToDays(m) { return Math.max(1, Math.round(m * 30.44)); }
function plBlockName(b) { return b.final ? 'Final revision' : (b.type === 'S' ? 'Study cycle ' : 'Revision cycle ') + b.n; }
const PL_ORDER = ['ANATOMY', 'PHYSIOLOGY', 'BIOCHEMISTRY', 'PATHOLOGY', 'PHARMACOLOGY', 'MICROBIOLOGY', 'FMT', 'PSM', 'OPHTHALMOLOGY', 'ENT',
  'MEDICINE', 'SURGERY', 'OBGY', 'PEDIATRICS', 'ORTHOPEDICS', 'DERMATOLOGY', 'PSYCHIATRY', 'RADIOLOGY', 'ANESTHESIOLOGY'];
function plSubjectName(id) { const s = (state.curriculum.subjects || []).find(x => x.subject_id === id); return s ? s.name : id; }
function plBankCounts() {
  const c = { pyq: 0, add: 0, bySubject: {} };
  (state.curriculum.subjects || []).forEach(s => {
    let p = 0, a = 0;
    s.units.forEach(u => { const k = u.counts || {}; p += k.PYQ || 0; a += k.PRACTICE || 0; });
    c.pyq += p; c.add += a; c.bySubject[s.subject_id] = { pyq: p, add: a };
  });
  return c;
}

// ---- plan geometry: each block gets [startDay, endDay) as day offsets from plan.start ----
function plLayout(plan) {
  let d = 0;
  return plan.blocks.map(b => { const days = b.days || plMonthsToDays(b.months); const r = Object.assign({}, b, { from: d, to: d + days, days }); d += days; return r; });
}
function plTargetFor(b) { return (b.pyq || 0) + (b.add || 0) + (b.rev || 0); }
function plExpectedThrough(plan, dayIdx) {
  if (dayIdx < 0) return 0;
  let n = 0;
  plLayout(plan).forEach(b => { const last = Math.min(dayIdx, b.to - 1); if (last >= b.from) n += (last - b.from + 1) * plTargetFor(b); });
  return n;
}
function plBlockAt(plan, dayIdx) { return plLayout(plan).find(b => dayIdx >= b.from && dayIdx < b.to) || null; }
// study block: which subject is scheduled on a given day (days split by each subject's question count)
function plSubjectSchedule(plan, b) {
  const order = (plan.subjectOrder && plan.subjectOrder.length ? plan.subjectOrder : PL_ORDER);
  const bank = plBankCounts().bySubject;
  const w = order.map(id => (bank[id] ? bank[id].pyq + bank[id].add : 0));
  const tot = w.reduce((a, x) => a + x, 0) || 1;
  let acc = 0;
  return order.map((id, i) => { const from = b.from + Math.round(b.days * acc / tot); acc += w[i]; const to = b.from + Math.round(b.days * acc / tot); return { id, from, to }; });
}

// ---- progress from the answer log ----
async function plProgress() {
  const plan = state.userData.plan;
  if (!plan) return null;
  const log = await alogAll();
  const today = plDayKey(Date.now());
  const dayIdx = plDaysBetween(plan.start, today);
  const daily = log.filter(r => r.daily);
  const done = daily.length;
  // today's own target counts only Daily Target answers; Catch up answers go to the backlog
  const todayRecs = daily.filter(r => r.daily === today && !r.cu);
  const doneToday = { PYQ: 0, ADD: 0, REV: 0 };
  todayRecs.forEach(r => { if (doneToday[r.part] != null) doneToday[r.part]++; });
  const lay = plLayout(plan);
  const end = lay.length ? lay[lay.length - 1].to : 0;
  const b = plBlockAt(plan, dayIdx);
  const tgt = b ? { PYQ: b.pyq || 0, ADD: b.add || 0, REV: b.rev || 0 } : { PYQ: 0, ADD: 0, REV: 0 };
  const todayTarget = tgt.PYQ + tgt.ADD + tgt.REV;
  const expYesterday = plExpectedThrough(plan, Math.min(dayIdx - 1, end - 1));
  const expToday = plExpectedThrough(plan, Math.min(dayIdx, end - 1));
  const backlog = Math.max(0, expYesterday - (done - todayRecs.length));
  let status, msg;
  if (dayIdx < 0) { status = 'orange'; msg = 'Your plan starts on ' + plFmt(plan.start) + '.'; }
  else if (backlog > Math.max(1, 0.1 * (todayTarget || 1))) {
    status = 'red';
    const days = todayTarget ? (backlog / todayTarget).toFixed(1) : '';
    msg = 'You are behind by ' + backlog + ' questions' + (days ? ' (about ' + days + ' days of targets)' : '') + '. Use Catch up to close the gap.';
  } else if (done > expToday) {
    status = 'green';
    const ahead = done - expToday;
    msg = 'You are ahead of schedule by ' + ahead + ' questions' + (todayTarget ? ' (about ' + (ahead / todayTarget).toFixed(1) + ' days)' : '') + '.';
  } else {
    status = 'orange';
    const left = Math.max(0, expToday - done);
    msg = left ? 'You are on time. ' + left + ' questions left for today.' : 'You are on time and today\'s target is done.';
  }
  return { plan, today, dayIdx, block: b, end, done, doneToday, tgt, todayTarget, expYesterday, expToday, backlog, status, msg,
    daysLeft: Math.max(0, plDaysBetween(today, plan.target)) };
}

let DT_REFRESH = null, DT_LAST = null, DT_FROM_ANS = false;
const DT_WORD = { red: 'Behind schedule', orange: 'On time', green: 'Ahead of schedule' };
function dtDoneToday(P) { return P.doneToday.PYQ + P.doneToday.ADD + P.doneToday.REV; }
function dtRefreshLight(fromAnswer) {
  clearTimeout(DT_REFRESH);
  if (fromAnswer === true) DT_FROM_ANS = true;
  DT_REFRESH = setTimeout(async () => {
    const fromAns = DT_FROM_ANS; DT_FROM_ANS = false;
    const P = await plProgress();
    const cls = 'dt-light ' + (P ? 'dt-' + P.status : 'dt-none');
    ['dt-light', 'fab-dt-dot', 'dt-quiz-light'].forEach(id => { const el = document.getElementById(id); if (el) { el.className = cls + (id === 'fab-dt-dot' ? ' fab-dt-dot' : ''); el.title = P ? P.msg : 'Set up your study plan'; } });
    dtRenderFab(P);
    if (P) {
      const done = dtDoneToday(P), reached = P.todayTarget > 0 && done >= P.todayTarget;
      if (fromAns && DT_LAST && !DT_LAST.reached && reached) dtToast('🎉 Today\'s target done: ' + done + ' / ' + P.todayTarget);
      DT_LAST = { reached };
    }
  }, 150);
}
function dtToast(msg) {
  let t = document.getElementById('dt-toast');
  if (!t) { t = document.createElement('div'); t.id = 'dt-toast'; t.className = 'dt-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.remove('dt-toast-hide'); t.classList.add('dt-toast-show');
  clearTimeout(t._h); t._h = setTimeout(() => { t.classList.remove('dt-toast-show'); t.classList.add('dt-toast-hide'); }, 3200);
}
// Quick Actions card: status light, today's count and a short line
function dtRenderFab(P) {
  const box = document.getElementById('fab-dt-card');
  if (!box) return;
  if (!P) {
    box.innerHTML = '<div class="flex items-center justify-between gap-2"><div class="flex items-center gap-2"><span class="dt-light dt-none"></span><div><div class="text-[11px] font-bold text-slate-900 uppercase tracking-wide">Daily Target</div><div class="text-xs text-slate-500">No study plan yet</div></div></div>' +
      '<button onclick="toggleFabMenu(); planOpen()" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg shrink-0">Set up</button></div>';
    return;
  }
  const done = dtDoneToday(P), tgt = P.todayTarget, pct = tgt ? Math.min(100, Math.round(100 * done / tgt)) : 0;
  const reached = tgt > 0 && done >= tgt;
  const line = !P.block ? (P.dayIdx < 0 ? 'Plan starts ' + plFmt(P.plan.start) : 'Plan finished') :
    reached ? 'Today\'s target done' + (P.backlog ? ' · ' + P.backlog + ' backlog' : '') :
    (tgt - done) + ' left today' + (P.backlog ? ' · ' + P.backlog + ' backlog' : '');
  const bar = { red: 'bg-rose-500', orange: 'bg-amber-500', green: 'bg-emerald-500' }[P.status];
  const inSession = state.currentView === 'quiz' && state.dtCtx;
  box.innerHTML = '<button onclick="toggleFabMenu(); dtShowStatus()" class="w-full text-left" aria-label="Daily Target status">' +
    '<div class="flex items-center justify-between gap-2"><div class="flex items-center gap-2 min-w-0"><span class="dt-light dt-' + P.status + '"></span><div class="min-w-0">' +
    '<div class="text-[11px] font-bold text-slate-900 uppercase tracking-wide">Daily Target · ' + DT_WORD[P.status] + '</div>' +
    '<div class="text-xs text-slate-600 truncate">' + line + '</div></div></div>' +
    '<div class="text-sm font-extrabold text-slate-900 shrink-0">' + done + '<span class="text-slate-400 font-semibold">/' + tgt + '</span></div></div>' +
    '<div class="mt-2 h-1.5 w-full bg-slate-200/70 rounded-full overflow-hidden"><div class="h-full ' + bar + '" style="width:' + pct + '%"></div></div></button>' +
    (P.block && reached && !inSession ? '<button onclick="toggleFabMenu(); dtShowStatus().then(() => { const r = document.getElementById(\'dt-more-row\'); if (r) r.classList.remove(\'hidden\'); })" class="mt-2 w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg">Do more</button>' : '') +
    (P.block && !reached && !inSession ? '<button onclick="toggleFabMenu(); dtOpen()" class="mt-2 w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg">' + (done ? 'Continue today\'s questions' : 'Start today\'s questions') + '</button>' : '');
}

// ---- choosing questions ----
function dtFreshSince(log, sinceTs) { const s = new Set(); log.forEach(r => { if (r.ts >= sinceTs) s.add(r.qid); }); return s; }
async function dtStudyQuestions(P, need, log) {
  // need: { PYQ: n, ADD: n } ; serves the scheduled subject first, then the next subjects in the plan order
  const T = await stEnsureTopics();
  const plan = P.plan, b = P.block;
  const sched = plSubjectSchedule(plan, b);
  let cur = sched.findIndex(x => P.dayIdx >= x.from && P.dayIdx < x.to);
  if (cur < 0) cur = 0;
  const seen = dtFreshSince(log, plParse(plAddDays(plan.start, b.from)).getTime());
  const out = { PYQ: [], ADD: [] };
  const typeOf = { PYQ: 0, ADD: 1 };
  const bySubject = {};
  Object.keys(T.q).forEach(qid => { const m = T.q[qid]; const sid = T.topics[m[1]][1]; (bySubject[sid] || (bySubject[sid] = [])).push(qid); });
  ['PYQ', 'ADD'].forEach(part => {
    for (let k = 0; k < sched.length && out[part].length < need[part]; k++) {
      const sid = sched[(cur + k) % sched.length].id;
      (bySubject[sid] || []).forEach(qid => { if (out[part].length < need[part] && T.q[qid][2] === typeOf[part] && !seen.has(qid)) out[part].push(qid); });
    }
  });
  return { list: out, subject: sched[cur] ? sched[cur].id : null };
}
async function dtBuildSession(P, catchUp) {
  const log = await alogAll();
  const b = P.block;
  let need;
  if (catchUp) {
    const t = P.todayTarget || 1, n = typeof catchUp === 'number' ? catchUp : P.backlog;
    need = { PYQ: Math.round(n * P.tgt.PYQ / t), ADD: Math.round(n * P.tgt.ADD / t) };
    need.REV = Math.max(0, n - need.PYQ - need.ADD);
  } else {
    need = { PYQ: Math.max(0, P.tgt.PYQ - P.doneToday.PYQ), ADD: Math.max(0, P.tgt.ADD - P.doneToday.ADD), REV: Math.max(0, P.tgt.REV - P.doneToday.REV) };
  }
  let study = { list: { PYQ: [], ADD: [] }, subject: null };
  if (b && b.type === 'S' && (need.PYQ || need.ADD)) study = await dtStudyQuestions(P, need, log);
  else if (b && (need.PYQ || need.ADD)) {
    // revision cycle: PYQ / Additional quotas are filled with revision picks of that type
    study.list.PYQ = need.PYQ ? await stPickRevision({ count: need.PYQ, types: [0], exclude: srsDueIdsToday() }) : [];
    study.list.ADD = need.ADD ? await stPickRevision({ count: need.ADD, types: [1], exclude: study.list.PYQ.concat(srsDueIdsToday()) }) : [];
  }
  let revSubjects = null;
  if (b && b.type === 'S') {
    // in study cycles, revise only subjects already reached in the plan
    const earlierStudy = plLayout(P.plan).some(x => x.type === 'S' && x.to <= b.from);
    if (!earlierStudy) { const sched = plSubjectSchedule(P.plan, b); revSubjects = sched.filter(x => x.from <= P.dayIdx).map(x => x.id); }
  }
  const exclude = study.list.PYQ.concat(study.list.ADD, srsDueIdsToday());
  const rev = need.REV ? await stPickRevision({ count: need.REV, subjects: revSubjects, types: [0, 1], exclude }) : [];
  const part = {};
  study.list.PYQ.forEach(q => part[q] = 'PYQ'); study.list.ADD.forEach(q => part[q] = 'ADD'); rev.forEach(q => part[q] = 'REV');
  const ids = study.list.PYQ.concat(study.list.ADD, rev);
  const prev = new Set(log.map(r => r.qid)), seen = {};
  ids.forEach(q => { if (prev.has(q)) seen[q] = 1; });
  return { ids, part, subject: study.subject, need, seen };
}
async function dtLaunchIds(ids, title, subtitle, ctx) {
  const T = await stEnsureTopics();
  const sids = [...new Set(ids.map(q => T.q[q] ? T.topics[T.q[q][1]][1] : null).filter(Boolean))];
  if (!(await ensureSubjects(sids))) return;
  const qs = ids.map(id => findQuestionById(id)).filter(Boolean);
  if (!qs.length) { alert('No questions available for this session.'); return; }
  state.rfList = qs; state.rfTitle = title; state.rfSubtitle = subtitle; state.rfListCtx = ctx || null;
  launchRapidFireNow('LIST');
}

// ---- Daily Target tab ----
let DT_BUSY = false;
async function dtOpen() {
  if (!state.userData.plan) { planOpen(); return; }
  if (DT_BUSY) return;
  DT_BUSY = true;
  try {
    const P = await plProgress();
    if (!P.block) { dtShowStatus(); return; }
    const done = dtDoneToday(P);
    const left = Math.max(0, P.todayTarget - done);
    if (!left) { dtShowStatus(); return; }
    dtToast('Preparing today\'s questions…');
    const S = await dtBuildSession(P, false);
    if (!S.ids.length) { dtShowStatus('No new questions left for this plan step. Try Catch up or a revision drill.'); return; }
    await dtLaunchIds(S.ids, '🎯 Daily Target', '', { day: P.today, part: S.part, seen: S.seen, kind: 'today', block: plBlockName(P.block), btype: P.block.type, target: P.todayTarget, doneBefore: done, total: S.ids.length });
  } finally { DT_BUSY = false; dtHideToast(); }
}
function dtHideToast() { const t = document.getElementById('dt-toast'); if (t && /Preparing/.test(t.textContent)) { t.classList.remove('dt-toast-show'); t.classList.add('dt-toast-hide'); } }
async function dtCatchUp() {
  const P = await plProgress();
  if (!P || !P.backlog) return;
  dtCloseStatus();
  dtToast('Preparing catch-up questions…');
  try {
    const S = await dtBuildSession(P, true);
    await dtLaunchIds(S.ids, '🎯 Catch up', '', { day: P.today, part: S.part, cu: true, seen: S.seen, kind: 'cu', block: plBlockName(P.block), btype: P.block ? P.block.type : 'R', total: S.ids.length });
  } finally { dtHideToast(); }
}
async function dtMore(n) {
  const P = await plProgress();
  if (!P || !P.block) return;
  dtCloseStatus();
  dtToast('Preparing extra questions…');
  try {
    const S = await dtBuildSession(P, n);
    if (!S.ids.length) { alert('No more questions available for this plan step right now.'); return; }
    await dtLaunchIds(S.ids, '🎯 Daily Target · extra', '', { day: P.today, part: S.part, seen: S.seen, kind: 'more', block: plBlockName(P.block), btype: P.block.type, total: S.ids.length });
  } finally { dtHideToast(); }
}
// live subtitle: cycle · subject of this question · new / seen / revision · how many left
function dtSubtitle(q) {
  const c = state.dtCtx, el = document.getElementById('quiz-unit-subtitle');
  if (!c || !el || !c.kind) return;
  const answered = Object.keys(state.userAnswers || {}).length, left = Math.max(0, (c.total || 0) - answered);
  const part = c.part[q.id], rev = part === 'REV' || c.btype === 'R';
  const chip = rev ? ['Revision', 'bg-emerald-100 text-emerald-800'] : c.seen && c.seen[q.id] ? ['Seen before', 'bg-amber-100 text-amber-800'] : ['New question', 'bg-indigo-100 text-indigo-800'];
  const typ = part === 'ADD' ? 'Additional' : part === 'PYQ' ? 'PYQ' : '';
  const count = c.kind === 'today' ? left + ' left of today\'s ' + c.target + (c.doneBefore ? ' (' + c.doneBefore + ' done before this session)' : '') :
    c.kind === 'cu' ? left + ' backlog questions left' : left + ' extra left';
  el.innerHTML = pgEsc(c.block + ' · ' + plSubjectName(q.subject_id)) + ' · <span class="inline-block px-1.5 rounded font-bold ' + chip[1] + '">' + chip[0] + (typ ? ' · ' + typ : '') + '</span> · ' + count;
}
function dtCloseStatus() { const m = document.getElementById('dt-modal'); if (m) m.classList.add('hidden'); }
async function dtShowStatus(note) {
  const m = document.getElementById('dt-modal'), body = document.getElementById('dt-modal-body');
  if (!m || !body) return;
  const P = await plProgress();
  if (!P) { planOpen(); return; }
  const col = { red: 'bg-rose-50 border-rose-200 text-rose-800', orange: 'bg-amber-50 border-amber-200 text-amber-800', green: 'bg-emerald-50 border-emerald-200 text-emerald-800' }[P.status];
  const word = { red: 'Behind schedule', orange: 'On time', green: 'Ahead of schedule' }[P.status];
  const b = P.block;
  let h = '<div class="rounded-xl border p-3 ' + col + '"><div class="flex items-center gap-2 font-bold text-sm"><span class="dt-light dt-' + P.status + '"></span>' + word + '</div><p class="text-xs mt-1 leading-relaxed">' + P.msg + '</p></div>';
  if (note) h += '<p class="text-xs text-slate-600">' + pgEsc(note) + '</p>';
  h += '<div class="grid grid-cols-2 gap-2 text-xs">' +
    '<div class="bg-slate-50 rounded-lg p-2.5"><div class="text-slate-500">Now</div><div class="font-bold text-slate-900">' + (b ? plBlockName(b) + ', day ' + (P.dayIdx - b.from + 1) + ' of ' + b.days : (P.dayIdx < 0 ? 'Not started' : 'Plan finished')) + '</div></div>' +
    '<div class="bg-slate-50 rounded-lg p-2.5"><div class="text-slate-500">Target date</div><div class="font-bold text-slate-900">' + plFmt(P.plan.target) + ' (' + P.daysLeft + ' days)</div></div>' +
    '<div class="bg-slate-50 rounded-lg p-2.5"><div class="text-slate-500">Today</div><div class="font-bold text-slate-900">' + (P.doneToday.PYQ + P.doneToday.ADD + P.doneToday.REV) + ' / ' + P.todayTarget + '</div><div class="text-[10px] text-slate-500">PYQ ' + P.doneToday.PYQ + '/' + P.tgt.PYQ + ' · Additional ' + P.doneToday.ADD + '/' + P.tgt.ADD + ' · Revision ' + P.doneToday.REV + '/' + P.tgt.REV + '</div></div>' +
    '<div class="bg-slate-50 rounded-lg p-2.5"><div class="text-slate-500">Plan total so far</div><div class="font-bold text-slate-900">' + P.done + ' done / ' + P.expToday + ' due</div></div></div>';
  h += '<div class="flex flex-wrap gap-2">';
  const left = P.todayTarget - P.doneToday.PYQ - P.doneToday.ADD - P.doneToday.REV;
  const inSession = state.currentView === 'quiz' && state.dtCtx && state.quizMode === 'RAPID_FIRE';
  if (inSession) h += '<button onclick="dtCloseStatus()" class="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold">Back to questions</button>';
  else if (P.block && left > 0) h += '<button onclick="dtCloseStatus(); dtOpen()" class="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold">' + (left < P.todayTarget ? 'Continue today\'s questions (' + left + ' left)' : 'Start today\'s questions') + '</button>';
  if (P.backlog && !inSession) h += '<button onclick="dtCatchUp()" class="px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold">Catch up ' + P.backlog + '</button>';
  if (!inSession) h += '<button onclick="dtCloseStatus(); planOpen()" class="px-3 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold">Edit plan</button>';
  if (!inSession && P.block && left <= 0) h += '<button onclick="document.getElementById(\'dt-more-row\').classList.toggle(\'hidden\')" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold">Do more</button>';
  h += '</div>';
  if (!inSession && P.block && left <= 0) h += '<div id="dt-more-row" class="hidden bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-2"><div class="text-xs text-emerald-900">Feeling keen? Extra questions follow today\'s mix and count towards your plan, putting you ahead.</div><div class="flex flex-wrap gap-2">' +
    [10, 20, 30, 50].map(n => '<button onclick="dtMore(' + n + ')" class="px-3 py-1.5 bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-800 rounded-lg text-xs font-bold">' + n + ' more</button>').join('') + '</div></div>';
  h += '<p class="text-[11px] text-slate-500 leading-relaxed">Green = ahead, orange = on time, red = behind. Only questions answered from the Daily Target (or Catch up) count towards the plan. Answers already given today count towards today\'s numbers, so after a plan change you are only given what is still left (for example PYQ 3/10 leaves 7 PYQs).</p>';
  body.innerHTML = h;
  m.classList.remove('hidden');
}

// ---- remove from 20th Notebook / Spaced Review ----
// Only the list entry goes; the answer log stays, so My Strengths and revision picks are unchanged.
// A removed notebook entry is kept hidden (it can still seed strengths for answers older than the answer log).
function nbRemove(qid) {
  const m = state.userData.mistakes[qid]; if (!m) return;
  m.hidden = new Date().toISOString();
  state._rmUndo = { kind: 'nb', qid };
  saveUserData(); renderNotebookView();
}
function srsRemove(qid) {
  const r = state.userData.srs[qid]; if (!r) return;
  if (!state.userData.srsRemoved || typeof state.userData.srsRemoved !== 'object') state.userData.srsRemoved = {};
  state.userData.srsRemoved[qid] = Object.assign({ removed: new Date().toISOString() }, r);
  delete state.userData.srs[qid];
  state._rmUndo = { kind: 'srs', qid };
  saveUserData(); renderSrsView();
}
function rmUndo() {
  const u = state._rmUndo; if (!u) return;
  if (u.kind === 'nb') { const m = state.userData.mistakes[u.qid]; if (m) delete m.hidden; }
  else { const r = (state.userData.srsRemoved || {})[u.qid]; if (r) { delete r.removed; state.userData.srs[u.qid] = r; delete state.userData.srsRemoved[u.qid]; } }
  state._rmUndo = null;
  saveUserData();
  if (u.kind === 'nb') renderNotebookView(); else renderSrsView();
}
function rmUndoBanner(container, kind) {
  const u = state._rmUndo;
  if (!u || u.kind !== kind) return;
  container.insertAdjacentHTML('beforeend', '<div class="flex items-center justify-between gap-2 bg-slate-900 text-white rounded-xl px-4 py-2.5 text-xs"><span>Removed from ' + (kind === 'nb' ? 'the 20th Notebook' : 'Spaced Review') + '. Your answer history and strengths are unchanged.</span>' +
    '<span class="flex items-center gap-3 shrink-0"><button onclick="rmUndo()" class="font-bold underline">Undo</button><button onclick="state._rmUndo=null; ' + (kind === 'nb' ? 'renderNotebookView()' : 'renderSrsView()') + '" aria-label="Dismiss" class="text-slate-400">✕</button></span></div>');
}

// ---- revision tests ----
function rvTypes() { return [state.questionFilter === 'ADDITIONAL' ? 1 : state.questionFilter === 'EXTREME' ? 2 : 0]; }
function rvTypeName() { return state.questionFilter === 'ADDITIONAL' ? 'Additional' : state.questionFilter === 'EXTREME' ? 'Extreme' : 'PYQ'; }
async function rvStartGT(kind) {
  const pr = rvPrefs();
  const cfgs = {
    FULL: { name: 'Revision Grand Test (NEET pattern)', count: 200, durationMins: 210, pos: 4, neg: 1, maxMarks: 800 },
    MINI: { name: 'Revision Mini-GT', count: 50, durationMins: 50, pos: 4, neg: 1, maxMarks: 200 }
  };
  let cfg = cfgs[kind], subjects = null;
  if (kind === 'CUSTOM') {
    const n = Math.max(5, Math.min(300, pr.customCount));
    cfg = { name: 'Custom Revision Test', count: n, durationMins: Math.max(1, Math.round(n * pr.customMinPerQ)), pos: 4, neg: 1, maxMarks: n * 4 };
    subjects = pr.customSubjects;
  }
  if (!(await ensureSubjects(subjects || allSubjectIds()))) return;
  const ids = await stPickRevision({ count: cfg.count, subjects, types: rvTypes() });
  if (!ids.length) { alert('No ' + rvTypeName() + ' questions available for a revision test.'); return; }
  state.gtPresetCfg = cfg;
  state.gtPresetList = ids.map(id => { const q = findQuestionById(id); return q ? Object.assign({}, q, { subject_name: plSubjectName(q.subject_id) }) : null; }).filter(Boolean);
  startGrandTestNow('PRESET');
}
async function rvStartDrill() {
  const ids = await stPickRevision({ count: 100, types: rvTypes() });
  if (!ids.length) { alert('No ' + rvTypeName() + ' questions available for a revision drill.'); return; }
  dtLaunchIds(ids, '⚡ Revision Drill', ids.length + ' ' + rvTypeName() + ' questions weighted to your weak areas • End anytime', null);
}
function rvCustomSummary() {
  const p = rvPrefs();
  return p.customCount + ' questions · ' + Math.round(p.customCount * p.customMinPerQ) + ' min · ' + (p.customSubjects ? p.customSubjects.length + ' subjects' : 'all subjects');
}

// ---- Settings: revision mix + custom test ----
const RV_LABELS = [['W', 'Weak'], ['D', 'Developing'], ['N', 'Not started'], ['S', 'Strong'], ['M', 'Mastered']];
function rvSave(p) { state.userData.revPrefs = Object.assign({}, state.userData.revPrefs || {}, p); saveUserData(); }
function rvSetMix(k, v) { const m = rvPrefs().mix; m[k] = Number(v); rvSave({ mix: m }); rvMixLabels(); }
function rvResetMix() { rvSave({ mix: Object.assign({}, RV_DEFAULT_MIX) }); rvRenderSettings(); }
function rvMixLabels() {
  const m = rvPrefs().mix, tot = RV_LABELS.reduce((n, x) => n + (m[x[0]] || 0), 0) || 1;
  RV_LABELS.forEach(x => { const el = document.getElementById('rv-pct-' + x[0]); if (el) el.textContent = Math.round(100 * (m[x[0]] || 0) / tot) + '%'; });
}
function rvToggleSubject(id) {
  const p = rvPrefs(); let s = p.customSubjects ? p.customSubjects.slice() : allSubjectIds();
  s = s.indexOf(id) >= 0 ? s.filter(x => x !== id) : s.concat([id]);
  rvSave({ customSubjects: s.length === allSubjectIds().length ? null : s }); rvRenderSettings();
}
function rvRenderSettings() {
  const box = document.getElementById('settings-extra');
  if (!box) return;
  const p = rvPrefs();
  let h = '<div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3"><div class="flex items-center justify-between"><div class="text-xs font-bold text-slate-800">Revision mix</div>' +
    '<button onclick="rvResetMix()" class="text-[11px] text-indigo-600 underline">Reset to default</button></div>' +
    '<p class="text-xs text-slate-600 leading-relaxed">How revision tests, revision drills and daily revision questions are shared across your strength bands. Move the sliders; the percentages always add up to 100.</p>';
  RV_LABELS.forEach(x => {
    h += '<div><div class="flex justify-between text-[11px] font-semibold text-slate-700"><span>' + x[1] + '</span><span id="rv-pct-' + x[0] + '"></span></div>' +
      '<input type="range" min="0" max="100" step="5" value="' + (p.mix[x[0]] || 0) + '" oninput="rvSetMix(\'' + x[0] + '\', this.value)" class="w-full accent-indigo-600"></div>';
  });
  h += '</div><div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3"><div class="text-xs font-bold text-slate-800">Custom revision test</div>' +
    '<div class="grid grid-cols-2 gap-2"><label class="text-[11px] font-semibold text-slate-700">Questions<input type="number" min="5" max="300" value="' + p.customCount + '" onchange="rvSave({customCount: Math.max(5, Math.min(300, Number(this.value) || 50))}); rvRenderSettings()" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"></label>' +
    '<label class="text-[11px] font-semibold text-slate-700">Minutes per question<input type="number" min="0.3" max="5" step="0.05" value="' + p.customMinPerQ + '" onchange="rvSave({customMinPerQ: Math.max(0.3, Math.min(5, Number(this.value) || 1.05))}); rvRenderSettings()" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"></label></div>' +
    '<div class="text-[11px] text-slate-600">' + rvCustomSummary() + '</div><div class="flex flex-wrap gap-1">';
  (state.curriculum.subjects || []).forEach(s => {
    const on = !p.customSubjects || p.customSubjects.indexOf(s.subject_id) >= 0;
    h += '<button onclick="rvToggleSubject(\'' + s.subject_id + '\')" class="px-2 py-1 rounded-lg border text-[10px] font-semibold ' + (on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-300') + '">' + pgEsc(s.name) + '</button>';
  });
  h += '</div></div><div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2"><div class="text-xs font-bold text-slate-800">Study plan</div><p class="text-xs text-slate-600">' +
    (state.userData.plan ? 'Target ' + plFmt(state.userData.plan.target) + ' · ' + state.userData.plan.blocks.map(plBlockName).join(' → ') : 'No plan yet.') + '</p>' +
    '<button onclick="toggleSettingsModal(); planOpen()" class="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold">' + (state.userData.plan ? 'Edit study plan' : 'Set up study plan') + '</button></div>';
  box.innerHTML = h;
  rvMixLabels();
}

// ---- plan wizard ----
const PW = { step: 0, d: null };
function planDefaults() {
  const today = plDayKey(Date.now());
  return { start: today, target: plAddDays(today, 304), nS: 2, nR: 2, blocks: null, subjectOrder: PL_ORDER.filter(id => (state.curriculum.subjects || []).some(s => s.subject_id === id)), conf: Object.assign({}, state.userData.confidence || {}),
    finalOn: true, fin: { pyq: 0, add: 0, rev: 150 } };
}
function planBlocksFor(d) {
  // alternate study and revision cycles: S1 R1 S2 R2 ...; months split to fill the time to the target date
  const out = []; let s = 0, r = 0;
  while (s < d.nS || r < d.nR) {
    if (s < d.nS) { s++; out.push({ type: 'S', n: s }); }
    if (r < d.nR && (r < s || s >= d.nS)) { r++; out.push({ type: 'R', n: r }); }
  }
  const total = plDaysBetween(d.start, d.target) / 30.44;
  const wS = 3, wR = 2, tw = out.reduce((n, b) => n + (b.type === 'S' ? wS : wR), 0) || 1;
  out.forEach(b => { b.months = Math.max(0.5, Math.round(2 * total * (b.type === 'S' ? wS : wR) / tw) / 2); });
  planSuggestTargets(d, out);
  return out;
}
function planSuggestTargets(d, blocks) {
  const bank = plBankCounts();
  blocks.forEach(b => {
    const days = plMonthsToDays(b.months);
    if (b.type === 'S') { b.pyq = Math.ceil(bank.pyq / days); b.add = Math.ceil(bank.add / days); b.rev = b.rev != null ? b.rev : 20; }
    else { b.pyq = 0; b.add = 0; b.rev = 150; }
  });
}
function planOpen() {
  const p = state.userData.plan;
  PW.step = 0;
  const fb = p ? p.blocks.find(b => b.final) : null, pb = p ? p.blocks.filter(b => !b.final) : [];
  PW.d = p ? { start: p.start, target: p.target, nS: pb.filter(b => b.type === 'S').length, nR: pb.filter(b => b.type === 'R').length,
    blocks: pb.map(b => Object.assign({}, b)), subjectOrder: (p.subjectOrder || []).slice(), conf: Object.assign({}, state.userData.confidence || {}),
    finalOn: p.finalOn != null ? !!p.finalOn : !!fb, fin: fb ? { pyq: fb.pyq || 0, add: fb.add || 0, rev: fb.rev || 0 } : { pyq: 0, add: 0, rev: 150 } } : planDefaults();
  document.getElementById('plan-modal').classList.remove('hidden');
  planRender();
}
function planClose(skip) {
  document.getElementById('plan-modal').classList.add('hidden');
  if (skip && !state.userData.plan) { state.userData.planSkipped = new Date().toISOString(); saveUserData(); }
}
function planNext() {
  const d = PW.d;
  if (PW.step === 0) {
    if (plDaysBetween(d.start, d.target) < 14) { alert('Please pick a target date at least two weeks after the start date.'); return; }
  }
  if (PW.step === 1) {
    if (d.nS < 1) { alert('Pick at least one study cycle.'); return; }
    const cs = (d.blocks || []).filter(b => b.type === 'S').length, cr = (d.blocks || []).filter(b => b.type === 'R').length;
    if (!d.blocks || cs !== d.nS || cr !== d.nR) d.blocks = planBlocksFor(d);
  }
  if (PW.step === 0 && !d.blocks) d.blocks = null;
  PW.step++; planRender();
}
function planBack() { PW.step = Math.max(0, PW.step - 1); planRender(); }
function planMove(i, dir) { const b = PW.d.blocks, j = i + dir; if (j < 0 || j >= b.length) return; [b[i], b[j]] = [b[j], b[i]]; planRender(); }
function planMonths(i, v) { PW.d.blocks[i].months = Math.max(0.5, Math.min(36, Number(v) || 0.5)); planRender(); }
function planFit() {
  const d = PW.d, total = plDaysBetween(d.start, d.target) / 30.44, cur = d.blocks.reduce((n, b) => n + b.months, 0) || 1;
  d.blocks.forEach(b => { b.months = Math.max(0.5, Math.round(2 * b.months * total / cur) / 2); });
  planRender();
}
// Final revision: an optional last cycle that takes whatever time is left before the target date
function planFinalDays(d) {
  const used = d.blocks.reduce((n, b) => n + plMonthsToDays(b.months), 0);
  return Math.max(0, plDaysBetween(d.start, d.target) - used);
}
function planFinalToggle(on) { PW.d.finalOn = !!on; planRender(); }
function planSetFin(k, v) { PW.d.fin[k] = Math.max(0, Math.min(2000, Math.round(Number(v) || 0))); planRender(); }
function planSet(i, k, v) { PW.d.blocks[i][k] = Math.max(0, Math.min(2000, Math.round(Number(v) || 0))); planRender(); }
function planSuggest() { planSuggestTargets(PW.d, PW.d.blocks); planRender(); }
function planSubjMove(i, dir) { const o = PW.d.subjectOrder, j = i + dir; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; planRender(); }
function planConf(sid, code) { PW.d.conf[sid] = code; planRender(); }
function planSave() {
  const d = PW.d;
  // block day lengths: months -> days; the last block absorbs rounding so the plan ends on the target date
  const blocks = d.blocks.map(b => ({ type: b.type, n: b.n, months: b.months, days: plMonthsToDays(b.months), pyq: b.pyq || 0, add: b.add || 0, rev: b.rev || 0 }));
  const avail = plDaysBetween(d.start, d.target);
  const sum = blocks.reduce((n, b) => n + b.days, 0);
  const left = avail - sum;
  if (d.finalOn && left >= 7) {
    blocks.push({ type: 'R', n: blocks.filter(b => b.type === 'R').length + 1, final: true, months: Math.round(10 * left / 30.44) / 10, days: left, pyq: d.fin.pyq, add: d.fin.add, rev: d.fin.rev });
  } else if (Math.abs(left) <= 20 && blocks.length) blocks[blocks.length - 1].days = Math.max(1, blocks[blocks.length - 1].days + left);
  const old = state.userData.plan;
  state.userData.plan = { v: 1, finalOn: !!d.finalOn, created: old ? old.created : new Date().toISOString(), updated: new Date().toISOString(), start: d.start, target: d.target, blocks, subjectOrder: d.subjectOrder };
  state.userData.confidence = Object.assign({}, state.userData.confidence || {}, d.conf);
  state.userData.confidenceDate = new Date().toISOString();
  delete state.userData.planSkipped;
  saveUserData();
  planClose(false);
  if (state.currentView === 'strengths') renderStrengthsView();
  dtRefreshLight();
}
function planInput(cls) { return 'class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm ' + (cls || '') + '"'; }
function planRender() {
  const d = PW.d, body = document.getElementById('plan-body');
  const steps = ['Target date', 'Cycles', 'Arrange cycles', 'Daily targets', 'Subject order', 'Confidence'];
  let h = '<div class="flex items-center justify-between"><div><div class="text-[11px] font-bold text-indigo-600 uppercase tracking-wider">Step ' + (PW.step + 1) + ' of ' + steps.length + '</div>' +
    '<h4 class="font-bold text-slate-900">' + steps[PW.step] + '</h4></div><button onclick="planClose(true)" class="text-slate-400 hover:text-slate-600 p-1" aria-label="Close">✕</button></div>';
  const avail = plDaysBetween(d.start, d.target), availM = (avail / 30.44).toFixed(1);
  if (PW.step === 0) {
    h += '<p class="text-xs text-slate-600 leading-relaxed">When do you want to finish your preparation? Usually this is a week or two before the exam.</p>' +
      '<div class="grid grid-cols-2 gap-3"><label class="block text-xs font-semibold text-slate-700">Plan starts<input type="date" value="' + d.start + '" max="' + plAddDays(d.target, -14) + '" onchange="if (this.value) { PW.d.start=this.value; PW.d.blocks=null; } planRender()" ' + planInput() + '></label>' +
      '<label class="block text-xs font-semibold text-slate-700">Target date<input type="date" value="' + d.target + '" min="' + plAddDays(d.start, 14) + '" onchange="if (this.value) { PW.d.target=this.value; PW.d.blocks=null; } planRender()" ' + planInput() + '></label></div>' +
      '<p class="text-xs text-slate-500">That is ' + avail + ' days (about ' + availM + ' months).' + (d.start !== plDayKey(Date.now()) ? ' <button onclick="PW.d.start=plDayKey(Date.now()); PW.d.blocks=null; planRender()" class="text-indigo-600 underline font-semibold">Start from today</button>' : '') + '</p>' +
      '<p class="text-[11px] text-slate-500 leading-relaxed">Days before today count as already scheduled, so a start date in the past creates a backlog.</p>';
  } else if (PW.step === 1) {
    h += '<p class="text-xs text-slate-600 leading-relaxed"><b>Study cycles</b> go through the question bank subject by subject. <b>Revision cycles</b> are pure revision, weighted to your weak areas.</p><div class="grid grid-cols-2 gap-3">' +
      '<label class="text-xs font-semibold text-slate-700">Study cycles<select onchange="PW.d.nS=Number(this.value)" ' + planInput() + '>' + [1, 2, 3, 4].map(n => '<option' + (n === d.nS ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
      '<label class="text-xs font-semibold text-slate-700">Revision cycles<select onchange="PW.d.nR=Number(this.value)" ' + planInput() + '>' + [0, 1, 2, 3, 4].map(n => '<option' + (n === d.nR ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label></div>';
  } else if (PW.step === 2) {
    const used = d.blocks.reduce((n, b) => n + b.months, 0);
    h += '<p class="text-xs text-slate-600 leading-relaxed">Put the cycles in the order you want and set months for each. You have about <b>' + availM + ' months</b>.</p><div class="space-y-2">';
    let off = 0;
    d.blocks.forEach((b, i) => {
      const from = plAddDays(d.start, off); off += plMonthsToDays(b.months);
      h += '<div class="flex items-center gap-2 border rounded-xl p-2.5 ' + (b.type === 'S' ? 'bg-indigo-50 border-indigo-200' : 'bg-emerald-50 border-emerald-200') + '">' +
        '<div class="flex flex-col"><button onclick="planMove(' + i + ',-1)" class="text-slate-500 hover:text-slate-900 text-xs px-1" aria-label="Move up">▲</button><button onclick="planMove(' + i + ',1)" class="text-slate-500 hover:text-slate-900 text-xs px-1" aria-label="Move down">▼</button></div>' +
        '<div class="flex-1 min-w-0"><div class="text-xs font-bold text-slate-900">' + plBlockName(b) + '</div><div class="text-[10px] text-slate-500">' + plFmt(from) + ' – ' + plFmt(plAddDays(d.start, off - 1)) + '</div></div>' +
        '<label class="text-[10px] font-semibold text-slate-600 w-20">Months<input type="number" min="0.5" max="36" step="0.5" value="' + b.months + '" onchange="planMonths(' + i + ', this.value)" ' + planInput('text-center') + '></label></div>';
    });
    const fd = planFinalDays(d), fm = (fd / 30.44).toFixed(1), finOn = d.finalOn && fd >= 7;
    h += '<div class="flex items-center gap-2 border border-dashed rounded-xl p-2.5 ' + (finOn ? 'bg-slate-100 border-slate-300' : 'bg-white border-slate-200 opacity-60') + '">' +
      '<div class="w-5"></div><div class="flex-1 min-w-0"><div class="text-xs font-bold text-slate-600">Final revision <span class="font-normal text-slate-400">(auto)</span></div>' +
      '<div class="text-[10px] text-slate-500">' + (!d.finalOn ? 'Off' : fd >= 7 ? plFmt(plAddDays(d.start, off)) + ' – ' + plFmt(plAddDays(d.target, -1)) + ' · fills the time left' : 'No time left over') + '</div></div>' +
      '<div class="text-xs font-bold text-slate-500 w-14 text-center">' + (finOn ? fm + ' mo' : '–') + '</div>' +
      '<label class="flex items-center gap-1 text-[10px] font-semibold text-slate-600 cursor-pointer"><input type="checkbox" ' + (d.finalOn ? 'checked' : '') + ' onchange="planFinalToggle(this.checked)" class="accent-indigo-600"> On</label></div>';
    const diff = used - avail / 30.44, gap = !finOn && diff < -0.6;
    h += '</div><div class="flex items-center justify-between text-xs"><span class="' + (diff > 0.6 || gap ? 'text-rose-600 font-semibold' : 'text-slate-500') + '">Total ' + used + (finOn ? ' + ' + fm + ' final' : '') + ' of ' + availM + ' months' + (diff > 0.6 ? ' (goes past your target)' : gap ? ' (finishes early)' : '') + '</span>' +
      '<button onclick="planFit()" class="text-indigo-600 underline font-semibold">Fit to target date</button></div>' +
      '<p class="text-[11px] text-slate-500 leading-relaxed"><b>Fit to target date</b> stretches or shrinks every cycle by the same proportion so they fill the time you have (rounded to half months). <b>Final revision</b>, when on, takes any time left after your cycles; it is greyed out because its length is set automatically.</p>';
  } else if (PW.step === 3) {
    const bank = plBankCounts();
    h += '<p class="text-xs text-slate-600 leading-relaxed">Questions per day for each cycle. Suggested numbers cover the whole bank (' + bank.pyq + ' PYQs, ' + bank.add + ' additional) once per study cycle.</p><div class="space-y-2">';
    d.blocks.forEach((b, i) => {
      const days = plMonthsToDays(b.months);
      const cov = b.type === 'S' ? ' · covers ' + Math.min(100, Math.round(100 * (b.pyq * days) / (bank.pyq || 1))) + '% of PYQs' : '';
      h += '<div class="border border-slate-200 rounded-xl p-2.5 space-y-1.5"><div class="text-xs font-bold text-slate-900">' + plBlockName(b) + ' <span class="font-normal text-slate-500">(' + b.months + ' months' + cov + ')</span></div><div class="grid grid-cols-3 gap-2">';
      const fields = b.type === 'S' ? [['pyq', 'PYQ / day'], ['add', 'Additional / day'], ['rev', 'Revision / day']] : [['pyq', 'PYQ / day'], ['add', 'Additional / day'], ['rev', 'Revision / day']];
      fields.forEach(f => { h += '<label class="text-[10px] font-semibold text-slate-600">' + f[1] + '<input type="number" min="0" max="2000" value="' + (b[f[0]] || 0) + '" onchange="planSet(' + i + ',\'' + f[0] + '\', this.value)" ' + planInput('text-center') + '></label>'; });
      h += '</div><div class="text-[10px] text-slate-500">' + plTargetFor(b) + ' questions a day</div></div>';
    });
    const fd3 = planFinalDays(d);
    if (d.finalOn && fd3 >= 7) {
      h += '<div class="border border-dashed border-slate-300 bg-slate-50 rounded-xl p-2.5 space-y-1.5"><div class="text-xs font-bold text-slate-900">Final revision <span class="font-normal text-slate-500">(' + (fd3 / 30.44).toFixed(1) + ' months, auto)</span></div><div class="grid grid-cols-3 gap-2">';
      [['pyq', 'PYQ / day'], ['add', 'Additional / day'], ['rev', 'Revision / day']].forEach(f => { h += '<label class="text-[10px] font-semibold text-slate-600">' + f[1] + '<input type="number" min="0" max="2000" value="' + (d.fin[f[0]] || 0) + '" onchange="planSetFin(\'' + f[0] + '\', this.value)" ' + planInput('text-center') + '></label>'; });
      h += '</div><div class="text-[10px] text-slate-500">' + ((d.fin.pyq || 0) + (d.fin.add || 0) + (d.fin.rev || 0)) + ' questions a day</div></div>';
    }
    h += '</div><p class="text-[11px] text-slate-500 leading-relaxed">In revision cycles every question is a revision question; the PYQ and Additional numbers set how many of each type. All revision questions follow your revision mix (Settings).</p><button onclick="planSuggest()" class="text-xs text-indigo-600 underline font-semibold">Use suggested numbers</button>';
  } else if (PW.step === 4) {
    h += '<p class="text-xs text-slate-600 leading-relaxed">Study cycles go through subjects in this order. Days are shared out by each subject\'s number of questions.</p><div class="space-y-1">';
    d.subjectOrder.forEach((id, i) => {
      h += '<div class="flex items-center gap-2 border border-slate-200 rounded-lg px-2 py-1.5"><span class="text-[11px] text-slate-400 w-5">' + (i + 1) + '</span><span class="flex-1 text-xs font-semibold text-slate-800">' + pgEsc(plSubjectName(id)) + '</span>' +
        '<button onclick="planSubjMove(' + i + ',-1)" class="text-slate-500 hover:text-slate-900 text-xs px-1.5" aria-label="Move up">▲</button><button onclick="planSubjMove(' + i + ',1)" class="text-slate-500 hover:text-slate-900 text-xs px-1.5" aria-label="Move down">▼</button></div>';
    });
    h += '</div>';
  } else {
    h += '<p class="text-xs text-slate-600 leading-relaxed">How confident are you in each subject right now? This is only a starting point for My Strengths; your answers take over as you practise.</p><div class="space-y-2.5">';
    (state.curriculum.subjects || []).forEach(s => {
      h += '<div class="space-y-1"><div class="text-xs font-semibold text-slate-800">' + pgEsc(s.name) + '</div><div class="flex flex-wrap gap-1">';
      ST_CFG.survey.forEach(b => {
        const on = d.conf[s.subject_id] === b[0];
        h += '<button type="button" onclick="planConf(\'' + s.subject_id + '\',\'' + b[0] + '\')" class="px-2 py-1 rounded-lg border text-[11px] font-semibold ' + (on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100') + '">' + b[1] + '</button>';
      });
      h += '</div></div>';
    });
    h += '</div>';
  }
  h += '<div class="flex justify-between gap-2 pt-2 border-t border-slate-100">' +
    (PW.step ? '<button onclick="planBack()" class="px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100">Back</button>' : '<button onclick="planClose(true)" class="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800">Later</button>') +
    (PW.step < steps.length - 1 ? '<button onclick="planNext()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold">Next</button>' : '<button onclick="planSave()" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold">Save plan</button>') + '</div>';
  body.innerHTML = h;
}
window.addEventListener('DOMContentLoaded', () => setTimeout(dtRefreshLight, 800));

// -------------------------------------------------------------
// UTILITIES & HELPERS
// -------------------------------------------------------------
function findQuestionById(qId) {
  if (!state.curriculum) return null;
  for (const s of state.curriculum.subjects) {
    for (const u of s.units) {
      const q = u.questions.find(x => x.id === qId);
      if (q) return q;
    }
  }
  return null;
}

function shuffleArray(arr) {
  const array = [...arr];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}


// ---------------- About us ----------------
function toggleAboutModal() {
  const m = document.getElementById('about-modal');
  if (!m) return;
  m.classList.toggle('hidden');
  if (!m.classList.contains('hidden')) { setTimeout(() => { try { lucide.createIcons(); } catch (e) {} }, 30); }
}
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  const m = document.getElementById('about-modal');
  if (m && !m.classList.contains('hidden')) m.classList.add('hidden');
});

function srsStepLabel(rec) {
  const steps = srsPrefs().steps, k = srsStepOf(rec, steps), nx = srsNextStep(rec, steps);
  return 'Step ' + k + ' of ' + steps.length + ' · ' + (nx == null ? 'last step' : 'if right: ' + nx + (nx === 1 ? ' day' : ' days'));
}

// ---------------- Daily Target landing page ----------------
function dtLanding() { switchView('daily'); }
async function dtRenderLanding() {
  const box = document.getElementById('dt-landing'); if (!box) return;
  const plan = state.userData.plan;
  const P = plan ? await plProgress() : null;
  const due = srsDueRecs().length, mins = Math.max(1, Math.round(due * 0.5)), nxt = srsNextDueDate();
  const esc = s => pgEsc(String(s));
  let h = '';
  // header
  let line = 'Set up a study plan to get a daily number of questions.';
  if (P) {
    const b = P.block;
    if (!b) line = P.dayIdx < 0 ? 'Your plan starts on ' + plFmt(P.plan.start) + '.' : 'Your plan has finished.';
    else {
      let subj = '';
      if (b.type === 'S') { const s = plSubjectSchedule(P.plan, b).find(x => P.dayIdx >= x.from && P.dayIdx < x.to); if (s) subj = ' · Today: ' + plSubjectName(s.id); }
      line = plBlockName(b) + ', day ' + (P.dayIdx - b.from + 1) + ' of ' + b.days + subj + ' · Exam ' + plFmt(P.plan.target) + ' (' + P.daysLeft + ' days)';
    }
  }
  h += '<div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3"><div><h2 class="text-lg sm:text-xl font-extrabold text-slate-900 flex items-center gap-2"><i data-lucide="target" class="w-5 h-5 text-rose-500"></i>Daily Target</h2>' +
    '<p class="text-xs sm:text-sm text-slate-500 mt-1">' + esc(line) + '</p></div>' +
    (plan ? '<button onclick="planOpen()" class="self-start sm:self-auto px-3 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold">Edit plan</button>' : '') + '</div>';
  // status
  if (P) {
    const col = { red: 'bg-rose-50 border-rose-200 text-rose-800', orange: 'bg-amber-50 border-amber-200 text-amber-800', green: 'bg-emerald-50 border-emerald-200 text-emerald-800' }[P.status];
    h += '<div class="rounded-2xl border p-4 ' + col + '"><div class="flex items-center justify-between gap-3 flex-wrap"><div><div class="flex items-center gap-2 font-bold text-sm"><span class="dt-light dt-' + P.status + '"></span>' + DT_WORD[P.status] + '</div>' +
      '<p class="text-xs mt-1 leading-relaxed">' + esc(P.msg) + '</p></div>' +
      (P.backlog ? '<button onclick="dtCatchUp()" class="px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold shrink-0">Catch up ' + P.backlog + '</button>' : '') + '</div></div>';
  }
  if (due > 0 && (!P || P.block)) h += '<div class="flex items-start gap-2 bg-white border border-rose-200 rounded-xl px-4 py-3 text-xs text-rose-900"><i data-lucide="lightbulb" class="w-4 h-4 text-rose-500 shrink-0 mt-0.5"></i><span><b>' + due + ' review' + (due === 1 ? '' : 's') + ' due</b> (about ' + mins + ' min). Doing them first works best: they are the questions you are closest to forgetting.</span></div>';
  // two main cards
  h += '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">';
  // Daily Target card
  h += '<div class="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center"><i data-lucide="play" class="w-5 h-5"></i></div>' +
    '<div><div class="text-sm font-bold text-slate-900">Today\'s questions</div><div class="text-[11px] text-slate-500">New PYQs and Additional questions for today\'s subject, then revision</div></div></div>';
  if (!P) {
    h += '<p class="text-xs text-slate-600">No study plan yet. The plan sets your exam date, cycles and how many questions a day.</p><button onclick="planOpen()" class="mt-auto w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold">Set up study plan</button>';
  } else {
    const done = dtDoneToday(P), tgt = P.todayTarget, left = Math.max(0, tgt - done), pct = tgt ? Math.min(100, Math.round(100 * done / tgt)) : 0;
    const bar = { red: 'bg-rose-500', orange: 'bg-amber-500', green: 'bg-emerald-500' }[P.status];
    const row = (t, a, b2, c) => '<div class="bg-slate-50 rounded-lg px-2 py-1.5 text-center"><div class="text-[10px] text-slate-500">' + t + '</div><div class="text-sm font-bold ' + c + '">' + a + '<span class="text-slate-400 font-semibold">/' + b2 + '</span></div></div>';
    h += '<div><div class="flex items-baseline justify-between"><span class="text-2xl font-extrabold text-slate-900">' + done + '<span class="text-base text-slate-400 font-bold"> / ' + tgt + '</span></span><span class="text-xs text-slate-500">' + (P.block ? (left ? left + ' left' : 'Done for today 🎉') : '') + '</span></div>' +
      '<div class="h-2 rounded-full bg-slate-100 mt-1.5 overflow-hidden"><div class="h-2 ' + bar + ' rounded-full" style="width:' + pct + '%"></div></div></div>' +
      '<div class="grid grid-cols-3 gap-2">' + row('PYQ', P.doneToday.PYQ, P.tgt.PYQ, 'text-indigo-700') + row('Additional', P.doneToday.ADD, P.tgt.ADD, 'text-sky-700') + row('Revision', P.doneToday.REV, P.tgt.REV, 'text-emerald-700') + '</div>';
    if (P.block && left > 0) h += '<button onclick="dtOpen()" class="mt-auto w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2"><i data-lucide="play" class="w-4 h-4"></i>' + (done ? 'Continue Daily Target (' + left + ' left)' : 'Start Daily Target') + '</button>';
    else if (P.block) h += '<div class="mt-auto bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-2"><div class="text-xs text-emerald-900">Today\'s target is done. Feeling keen? Extra questions follow today\'s mix and put you ahead.</div><div class="flex flex-wrap gap-2">' +
      [10, 20, 30, 50].map(n => '<button onclick="dtMore(' + n + ')" class="px-3 py-1.5 bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-800 rounded-lg text-xs font-bold">Do ' + n + ' more</button>').join('') + '</div></div>';
  }
  h += '</div>';
  // Spaced Review card
  h += '<div class="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center"><i data-lucide="calendar-check" class="w-5 h-5"></i></div>' +
    '<div><div class="text-sm font-bold text-slate-900">Spaced Review</div><div class="text-[11px] text-slate-500">Questions you got wrong, back after ' + srsPrefs().steps.join(', ') + ' days</div></div></div>' +
    '<div class="flex items-baseline justify-between"><span class="text-2xl font-extrabold ' + (due ? 'text-rose-600' : 'text-slate-900') + '">' + due + '<span class="text-base text-slate-400 font-bold"> due</span></span><span class="text-xs text-slate-500">' +
    (due ? 'about ' + mins + ' min' : nxt ? 'next on ' + nxt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'queue empty') + '</span></div>' +
    '<p class="text-[11px] text-slate-500 leading-relaxed">Steps and which modes add questions can be changed in Settings. Daily Target revision skips questions due here today, so nothing is served twice.</p>' +
    '<button onclick="switchView(\'srs\')" class="mt-auto w-full py-2.5 ' + (due ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'border border-slate-300 hover:bg-slate-100 text-slate-700') + ' rounded-xl text-sm font-bold flex items-center justify-center gap-2"><i data-lucide="calendar-check" class="w-4 h-4"></i>Open Spaced Review</button></div>';
  h += '</div>';
  if (P) h += '<p class="text-[11px] text-slate-500 leading-relaxed">Green = ahead, orange = on time, red = behind. Only questions answered from the Daily Target (or Catch up / Do more) count towards the plan.</p>';
  box.innerHTML = h;
  setTimeout(() => { try { lucide.createIcons(); } catch (e) {} }, 20);
}


// ================= 20261118h =================
// ---- Grand Test time per question ----
function gtAddTime() {
  if (state.quizMode !== 'GRAND_TEST' || !state.gtTimes || !state._qShownId || !state._qShownAt) return;
  const now = Date.now();
  state.gtTimes[state._qShownId] = (state.gtTimes[state._qShownId] || 0) + (now - state._qShownAt);
  state._qShownAt = now;
}
function gtFmt(ms) { const s = Math.round((ms || 0) / 1000); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's'; }
function gtTimeChip(id) {
  const ms = state.gtTimes[id] || 0, cfg = state.gtConfig || {}, pace = cfg.count ? cfg.durationMins * 60000 / cfg.count : 63000;
  const cls = !ms ? 'bg-slate-100 text-slate-400' : ms > 2 * pace ? 'bg-rose-100 text-rose-700' : ms > pace ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600';
  return '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-md ' + cls + '" title="Time spent on this question">⏱ ' + (ms ? gtFmt(ms) : 'not opened') + '</span>';
}
function gtTimeSummary(container, questions) {
  const T = state.gtTimes, cfg = state.gtConfig || {}, pace = cfg.count ? cfg.durationMins * 60000 / cfg.count : 63000;
  const rows = questions.map((q, i) => ({ q, i, ms: T[q.id] || 0, ch: state.userAnswers[q.id] }));
  const att = rows.filter(r => r.ch), right = att.filter(r => r.ch === r.q.correct_option), wrong = att.filter(r => r.ch !== r.q.correct_option);
  const avg = a => a.length ? a.reduce((s, r) => s + r.ms, 0) / a.length : 0;
  const total = rows.reduce((s, r) => s + r.ms, 0);
  const slow = rows.filter(r => r.ms > 0).sort((a, b) => b.ms - a.ms).slice(0, 5);
  const rushed = wrong.filter(r => r.ms > 0 && r.ms < 20000).length, stuck = wrong.filter(r => r.ms > 2 * pace).length;
  const box = document.createElement('div');
  box.className = 'bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3';
  const tile = (t, v, s) => '<div class="bg-slate-50 rounded-xl p-3"><div class="text-[11px] text-slate-500">' + t + '</div><div class="text-base font-extrabold text-slate-900">' + v + '</div>' + (s ? '<div class="text-[10px] text-slate-500">' + s + '</div>' : '') + '</div>';
  box.innerHTML = '<div class="flex items-center gap-2"><i data-lucide="timer" class="w-4 h-4 text-indigo-600"></i><h4 class="text-sm font-bold text-slate-900">Time per question</h4><span class="text-[11px] text-slate-500">exam pace ' + gtFmt(pace) + ' a question</span></div>' +
    '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">' + tile('Average (attempted)', gtFmt(avg(att)), gtFmt(total) + ' in total') + tile('On right answers', gtFmt(avg(right)), right.length + ' questions') + tile('On wrong answers', gtFmt(avg(wrong)), wrong.length + ' questions') +
    tile('Wrong under 20 s', rushed, stuck ? stuck + ' wrong after over ' + gtFmt(2 * pace) : 'possibly rushed') + '</div>' +
    (slow.length ? '<div class="text-xs text-slate-600"><b class="text-slate-800">Slowest:</b> ' + slow.map(r => '<button type="button" onclick="gtJump(' + r.i + ')" class="underline decoration-dotted hover:text-indigo-700">Q' + (r.i + 1) + ' (' + gtFmt(r.ms) + (r.ch ? (r.ch === r.q.correct_option ? ', right' : ', wrong') : ', skipped') + ')</button>').join(' · ') + '</div>' : '') +
    '<p class="text-[11px] text-slate-500">Each question shows its time. Amber = slower than exam pace, red = more than twice the pace. Time counts only while the question was on screen.</p>';
  container.appendChild(box);
}
function gtJump(i) { const el = document.querySelectorAll('#post-test-questions-list > div')[i + 1]; if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

// ---- Bookmarks ----
function bmAll() { if (!state.userData.bookmarks || typeof state.userData.bookmarks !== 'object') state.userData.bookmarks = {}; return state.userData.bookmarks; }
function bmHas(id) { return !!(state.userData.bookmarks || {})[id]; }
function bmPaint(el) {
  const on = bmHas(el.getAttribute('data-bm'));
  el.classList.toggle('bm-on', on);
  const t = el.querySelector('.bm-t'); if (t) t.textContent = on ? 'Bookmarked' : 'Bookmark';
  el.title = on ? 'Remove bookmark' : 'Bookmark this question';
}
function bmToggle(id, sid) {
  const B = bmAll();
  if (B[id]) delete B[id]; else B[id] = { subjectId: sid || null, ts: new Date().toISOString() };
  saveUserData();
  document.querySelectorAll('[data-bm="' + id + '"]').forEach(bmPaint);
  dtToast(B[id] ? '🔖 Bookmarked (20th Notebook → Bookmarks)' : 'Bookmark removed');
  if (state.currentView === 'notebook') renderNotebookView();
}
function bmToggleCurrent() { const q = state.activeQuestions[state.currentQIndex]; if (q) bmToggle(q.id, q.subject_id); }
function bmPaintCurrent(q) { const b = document.getElementById('btn-bookmark-q'); if (b && q) { b.setAttribute('data-bm', q.id); bmPaint(b); } }
function bmBtnHtml(id, sid) {
  const on = bmHas(id);
  return '<button type="button" data-bm="' + pgEsc(id) + '" onclick="bmToggle(\'' + pgEsc(id) + '\', \'' + pgEsc(sid || '') + '\')" class="bm-btn' + (on ? ' bm-on' : '') + '" title="' + (on ? 'Remove bookmark' : 'Bookmark this question') + '"><i data-lucide="bookmark" class="w-3.5 h-3.5"></i><span class="bm-t">' + (on ? 'Bookmarked' : 'Bookmark') + '</span></button>';
}
async function bmDrill(ids) {
  if (!ids.length) return;
  dtLaunchIds(ids, '🔖 Bookmarks drill', ids.length + ' bookmarked question' + (ids.length === 1 ? '' : 's') + ' • End anytime', null);
}

// 20th Notebook: Mistakes / Bookmarks sections
function nbRenderTabs() {
  const box = document.getElementById('nb-tabs'); if (!box) return;
  const tab = state.nbTab || 'M';
  const nM = Object.values(state.userData.mistakes || {}).filter(m => !m.hidden).length, nB = Object.keys(state.userData.bookmarks || {}).length;
  const b = (k, t, n, ic) => '<button type="button" onclick="state.nbTab=\'' + k + '\'; renderNotebookView()" class="flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition ' +
    (tab === k ? 'bg-amber-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100') + '"><i data-lucide="' + ic + '" class="w-4 h-4"></i>' + t + ' <span class="opacity-80">(' + n + ')</span></button>';
  box.innerHTML = b('M', 'Mistakes', nM, 'circle-x') + b('B', 'Bookmarks', nB, 'bookmark');
  const s = document.getElementById('notebook-search'); if (s) s.placeholder = tab === 'B' ? 'Search bookmarks…' : 'Search mistakes or drugs...';
}
async function bmRenderList() {
  const container = document.getElementById('notebook-container'), pills = document.getElementById('notebook-subject-pills');
  if (!container || !pills) return;
  const B = bmAll(), ids = Object.keys(B);
  const sids = [...new Set(ids.map(i => B[i].subjectId).filter(Boolean))].filter(id => state.curriculum.subjects.some(s => s.subject_id === id));
  if (sids.length) await ensureSubjects(sids);
  let items = ids.map(id => ({ id, b: B[id], q: findQuestionById(id) })).filter(x => x.q).sort((a, b) => String(b.b.ts).localeCompare(String(a.b.ts)));
  const sel = state.bmSubj || 'ALL';
  const subs = ['ALL', ...new Set(items.map(x => x.q.subject_id))];
  pills.innerHTML = subs.map(s => '<button type="button" onclick="state.bmSubj=\'' + s + '\'; renderNotebookView()" class="px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition ' +
    (sel === s ? 'bg-amber-600 text-white font-bold shadow-sm' : 'border border-slate-200 text-slate-600 hover:bg-slate-100') + '">' + (s === 'ALL' ? 'All (' + items.length + ')' : pgEsc(plSubjectName(s))) + '</button>').join('');
  if (sel !== 'ALL') items = items.filter(x => x.q.subject_id === sel);
  const query = (document.getElementById('notebook-search')?.value || '').toLowerCase().trim();
  if (query) items = items.filter(x => (x.q.question + ' ' + ((x.q.explanation || {}).rationale || '') + ' ' + ((x.q.explanation || {}).high_yield_pearl || '')).toLowerCase().includes(query));
  if (!items.length) {
    container.innerHTML = '<div class="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3"><div class="w-12 h-12 rounded-full bg-amber-100 text-amber-600 mx-auto flex items-center justify-center"><i data-lucide="bookmark" class="w-6 h-6"></i></div>' +
      '<h4 class="text-base font-bold text-slate-900">' + (ids.length ? 'No bookmarks match' : 'No bookmarks yet') + '</h4><p class="text-xs text-slate-500 max-w-sm mx-auto">Tap <b>Bookmark</b> next to Report on any question (or on a Grand Test review card) to keep it here for later.</p></div>';
    lucide.createIcons(); return;
  }
  let h = '<div class="flex items-center justify-between gap-3 flex-wrap"><span class="text-xs text-slate-500">' + items.length + ' bookmarked question' + (items.length === 1 ? '' : 's') + '</span>' +
    '<button type="button" onclick="bmDrill(' + pgEsc(JSON.stringify(items.map(x => x.id))).replace(/"/g, '&quot;') + ')" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2"><i data-lucide="play" class="w-4 h-4"></i>Drill these ' + items.length + '</button></div>';
  items.forEach(x => {
    const q = x.q, ex = q.explanation || {};
    h += '<div class="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3"><div class="flex items-center justify-between gap-2 flex-wrap"><div class="flex items-center gap-2 flex-wrap">' +
      '<span class="bg-amber-100 text-amber-800 text-[11px] font-bold px-2 py-0.5 rounded-md">' + pgEsc(plSubjectName(q.subject_id)) + '</span><span class="text-xs font-semibold text-slate-500">' + pgEsc(q.exam_source || '') + '</span></div>' +
      '<div class="flex items-center gap-1"><span class="text-[11px] text-slate-400">' + new Date(x.b.ts).toLocaleDateString() + '</span>' +
      '<button onclick="startSingleQuestionDrill(\'' + pgEsc(q.id) + '\')" class="px-3 py-1 bg-brand-50 hover:bg-brand-100 text-brand-700 rounded-lg text-xs font-bold">Review</button>' +
      '<button onclick="bmToggle(\'' + pgEsc(q.id) + '\')" class="btn-rm" title="Remove bookmark">Remove</button></div></div>' +
      '<h5 class="text-sm font-semibold text-slate-900 leading-snug">' + pgEsc(q.question) + '</h5>' +
      '<details class="text-xs text-slate-700"><summary class="cursor-pointer font-semibold text-amber-700">Show answer</summary><div class="mt-2 space-y-1.5"><p><b>Answer ' + pgEsc(q.correct_option) + ':</b> ' + pgEsc((q.options || {})[q.correct_option] || '') + '</p>' +
      (ex.rationale ? '<p class="text-slate-600">' + pgEsc(ex.rationale) + '</p>' : '') + (ex.high_yield_pearl ? '<p class="bg-amber-50 border border-amber-200 rounded-lg p-2"><b>Pearl:</b> ' + pgEsc(ex.high_yield_pearl) + '</p>' : '') + '</div></details></div>';
  });
  container.innerHTML = h;
  lucide.createIcons();
}

// ---- Mistake patterns (My Strengths) ----
let MP_RANGE = 30;
const MP_TIPS = {
  DK: 'These are knowledge gaps: read the Quick Theory for those topics before trying again.',
  MISREAD: 'Read the last line of the question first and watch for NOT, EXCEPT and MOST.',
  BUZZ: 'Read every option before choosing; a familiar buzzword is often the trap.',
  CHANGED: 'Your first answer was often right: change it only with a clear reason.',
  SURE: 'Confidently wrong usually means a misconception: reread the explanation and the pearl.'
};
function mpSetRange(n) { MP_RANGE = n; mpRender(); }
async function mpRender() {
  const box = document.getElementById('mp-container'); if (!box) return;
  const log = await alogAll(), now = Date.now(), from = MP_RANGE ? now - MP_RANGE * 864e5 : 0;
  const L = log.filter(r => r.ts >= from), W = L.filter(r => !r.correct), R = L.filter(r => r.correct);
  const chip = (n, t) => '<button type="button" onclick="mpSetRange(' + n + ')" class="px-2.5 py-1 rounded-lg text-[11px] font-bold ' + (MP_RANGE === n ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200') + '">' + t + '</button>';
  let h = '<div class="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3"><div class="flex items-center justify-between gap-2 flex-wrap"><div class="flex items-center gap-2"><i data-lucide="search-check" class="w-4 h-4 text-indigo-600"></i><h3 class="text-sm font-bold text-slate-900">Mistake patterns</h3>' +
    '<span class="text-[11px] text-slate-500">' + W.length + ' wrong of ' + L.length + ' answers</span></div><div class="flex gap-1">' + chip(7, '7 days') + chip(30, '30 days') + chip(0, 'All') + '</div></div>';
  if (W.length < 5) { box.innerHTML = h + '<p class="text-xs text-slate-500">Not enough mistakes in this period to see patterns yet (' + W.length + ' so far). Patterns appear after 5 wrong answers.</p></div>'; lucide.createIcons(); return; }
  const ins = [];
  // why-reasons
  const whyW = W.filter(r => r.why && MP_TIPS[r.why]);
  const wc = {}; whyW.forEach(r => wc[r.why] = (wc[r.why] || 0) + 1);
  if (whyW.length >= 3) {
    const top = Object.entries(wc).sort((a, b) => b[1] - a[1])[0];
    ins.push(['message-circle-question', Math.round(100 * top[1] / whyW.length) + '% of the misses you gave a reason for were "' + PG_LABEL[top[0]] + '". ' + MP_TIPS[top[0]]]);
  }
  // rushed
  const tW = W.filter(r => r.ms > 0), tR = R.filter(r => r.ms > 0);
  if (tW.length >= 5) {
    const fast = tW.filter(r => r.ms < 20000).length, med = a => { const s = a.map(r => r.ms).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    if (fast / tW.length >= 0.25) ins.push(['zap', Math.round(100 * fast / tW.length) + '% of your timed wrong answers came in under 20 seconds' + (tR.length ? ' (right answers take you about ' + gtFmt(med(tR)) + ')' : '') + '. Some of these may be rushed.']);
    const slowW = tW.filter(r => r.ms > 120000).length;
    if (slowW / tW.length >= 0.2) ins.push(['hourglass', slowW + ' wrong answers took over 2 minutes: long thinking often means the topic is shaky, not that more time will help.']);
  }
  // repeat misses
  const allWrong = {}; log.forEach(r => { if (!r.correct) allWrong[r.qid] = (allWrong[r.qid] || 0) + 1; });
  const rep = [...new Set(W.map(r => r.qid))].filter(q => allWrong[q] >= 2).length;
  if (rep) ins.push(['repeat', rep + ' question' + (rep === 1 ? ' was' : 's were') + ' missed more than once. These are your most stubborn gaps: they are in the 20th Notebook.']);
  // topics
  const T = await stEnsureTopics();
  if (T && T.q) {
    const tw = {}, tt = {};
    L.forEach(r => { const m = T.q[r.qid]; if (!m) return; const k = m[1]; tt[k] = (tt[k] || 0) + 1; if (!r.correct) tw[k] = (tw[k] || 0) + 1; });
    const top = Object.entries(tw).filter(e => e[1] >= 3).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (top.length) ins.push(['map-pin', 'Most misses: ' + top.map(e => { const t = T.topics[e[0]]; return '<b>' + pgEsc(t[3]) + '</b> <span class="text-slate-500">(' + pgEsc(plSubjectName(t[1])) + ', ' + e[1] + ' of ' + tt[e[0]] + ' wrong)</span>'; }).join('; ') + '.']);
  }
  // question type
  const ty = { PYQ: 'PYQ', PRACTICE: 'Additional', EXTREME: 'Extreme' }, acc = [];
  Object.keys(ty).forEach(k => { const a = L.filter(r => r.qtype === k); if (a.length >= 10) acc.push(ty[k] + ' ' + Math.round(100 * a.filter(r => r.correct).length / a.length) + '%'); });
  if (acc.length >= 2) ins.push(['percent', 'Accuracy by question type: ' + acc.join(' · ') + '.']);
  if (!ins.length) ins.push(['check', 'No strong pattern in this period. Keep answering; patterns get clearer with more answers.']);
  h += '<ul class="space-y-2">' + ins.slice(0, 5).map(i => '<li class="flex items-start gap-2.5 text-xs sm:text-sm text-slate-700 leading-relaxed"><span class="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><i data-lucide="' + i[0] + '" class="w-4 h-4"></i></span><span class="pt-1">' + i[1] + '</span></li>').join('') + '</ul>';
  // why-reason bars
  if (whyW.length) {
    const mx = Math.max(...Object.values(wc));
    h += '<details class="text-xs"><summary class="cursor-pointer font-semibold text-indigo-700">Why you missed (' + whyW.length + ' with a reason)</summary><div class="mt-2 space-y-1.5">' + PG_WRONG.map(p => { const n = wc[p[0]] || 0;
      return '<div class="flex items-center gap-2"><span class="w-52 shrink-0 text-slate-600 truncate">' + p[1] + '</span><span class="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden"><span class="block h-2 bg-indigo-500 rounded-full" style="width:' + (mx ? Math.round(100 * n / mx) : 0) + '%"></span></span><span class="w-8 text-right font-bold text-slate-700">' + n + '</span></div>'; }).join('') + '</div></details>';
  } else if (!pgOn()) {
    h += '<p class="text-[11px] text-slate-500">Turn on Advanced pedagogy mode in Settings to tell the app why you missed a question; the patterns get sharper.</p>';
  }
  box.innerHTML = h + '</div>';
  lucide.createIcons();
}

// ---- Installable app + offline ----
let PWA_PROMPT = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); PWA_PROMPT = e; pwaUpdateUi(); });
window.addEventListener('appinstalled', () => { PWA_PROMPT = null; try { dtToast('MedPrepAide installed'); } catch (x) {} pwaUpdateUi(); });
window.addEventListener('offline', () => { try { dtToast('You are offline. Saved subjects still work.'); } catch (x) {} });
window.addEventListener('online', () => { try { dtToast('Back online.'); } catch (x) {} });
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(e => console.warn('service worker', e)); });
}
function pwaStandalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
function pwaIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
async function pwaInstall() {
  if (!PWA_PROMPT) { if (document.getElementById('settings-modal').classList.contains('hidden')) toggleSettingsModal(); return; }
  PWA_PROMPT.prompt();
  try { await PWA_PROMPT.userChoice; } catch (e) {}
  PWA_PROMPT = null; pwaUpdateUi();
}
function pwaUpdateUi() {
  const b = document.getElementById('fab-install'); if (b) b.classList.toggle('hidden', !PWA_PROMPT || pwaStandalone());
  const m = document.getElementById('settings-modal'); if (m && !m.classList.contains('hidden')) pwaRenderSettings();
}
async function pwaSaved() {
  if (!('caches' in window)) return null;
  try {
    const c = await caches.open('mpa-files'), keys = await c.keys();
    const subj = [...new Set(keys.map(k => (k.url.match(/\/data\/q-([A-Z]+)\.js/) || [])[1]).filter(Boolean))];
    return { subj, theory: keys.some(k => /\/data\/theory\.js/.test(k.url)) };
  } catch (e) { return null; }
}
async function pwaRenderSettings() {
  const box = document.getElementById('settings-offline'); if (!box) return;
  const sw = 'serviceWorker' in navigator, ctl = sw && navigator.serviceWorker.controller, saved = await pwaSaved();
  let status;
  if (!sw || !saved) status = 'This browser cannot save the app for offline use.';
  else if (!ctl) status = 'Offline support starts the next time you open the app.';
  else {
    const all = state.curriculum.subjects, have = all.filter(s => saved.subj.includes(s.subject_id));
    status = '<b>Works offline:</b> the app, your progress and <b>' + have.length + ' of ' + all.length + ' subjects</b>' + (saved.theory ? ' plus Quick Theory' : '') + '.' +
      (have.length ? '<div class="flex flex-wrap gap-1 mt-1.5">' + have.map(s => '<span class="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.5 rounded">' + pgEsc(s.name) + '</span>').join('') + '</div>' : '') +
      '<div class="mt-1.5">Subjects are saved when you open them while online. Tests across all subjects need every subject saved.</div>';
  }
  let inst;
  if (pwaStandalone()) inst = '<span class="text-emerald-700 font-bold">✓ Installed as an app</span>';
  else if (PWA_PROMPT) inst = '<button onclick="pwaInstall()" class="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold">Install app</button>';
  else if (pwaIOS()) inst = 'On iPhone or iPad: tap <b>Share</b>, then <b>Add to Home Screen</b>.';
  else inst = 'To install, use the browser menu: <b>Install app</b> or <b>Add to Home screen</b>.';
  box.innerHTML = '<div class="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3.5 space-y-2.5"><div class="text-xs font-bold text-slate-800">Offline &amp; install</div>' +
    '<div class="text-[11px] text-slate-700 leading-relaxed">' + status + '</div><div class="text-[11px] text-slate-700">' + inst + '</div></div>';
}

function rvMarkLabel(ok, skipped) {
  const gt = state.quizMode === 'GRAND_TEST' && state.gtConfig, cfg = state.gtConfig || {};
  const num = n => String(Math.round(n * 100) / 100);
  if (skipped) return gt ? 'Not attempted (0)' : 'Not attempted';
  if (ok) return gt ? 'Correct (+' + num(cfg.pos) + ')' : 'Correct';
  return gt ? 'Incorrect (−' + num(cfg.neg) + ')' : 'Incorrect';
}
