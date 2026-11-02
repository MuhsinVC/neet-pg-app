// MedAide All-in-One Engine (19 Subjects, Grand Tests, Rapid Fire, SRS & 20th Notebook)

let state = {
  currentView: 'home',
  curriculum: null,
  questionFilter: 'ALL', // 'ALL' or 'PYQ'
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
const DATA_VERSION = '20261102j';
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
    alert('Could not download the question data. Please check your internet connection and try again.');
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
  if (state.questionFilter === 'PYQ') return c.PYQ;
  if (state.questionFilter === 'EXTREME') return c.EXTREME;
  return c.PYQ + c.PRACTICE;
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

window.addEventListener('DOMContentLoaded', () => {
  loadUserData();
  if (window.CURRICULUM_DATA) {
    state.curriculum = window.CURRICULUM_DATA;
    updateFilterCounts();
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
      totalAdditional += c.PYQ + c.PRACTICE;
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

  // Refresh current view
  if (state.currentView === 'home') renderSubjectsGrid();
  if (state.currentView === 'subject') renderSubjectUnits();
  if (state.currentView === 'theory') renderTheoryVault();
}

function getFilteredQuestions(questions) {
  if (state.questionFilter === 'PYQ') {
    return questions.filter(q => q.question_type === 'PYQ');
  }
  if (state.questionFilter === 'EXTREME') {
    return questions.filter(q => q.question_type === 'EXTREME');
  }
  // 'ADDITIONAL' returns all standard practice questions + authentic PYQs (excludes EXTREME)
  return questions.filter(q => q.question_type !== 'EXTREME');
}

// -------------------------------------------------------------
// VIEW SWITCHING
// -------------------------------------------------------------
function switchView(viewName) {
  state.currentView = viewName;
  const views = ['home', 'subject', 'grand-test', 'rapid-fire', 'theory', 'quiz', 'post-test', 'srs', 'notebook'];
  
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

    let answeredCorrect = 0;
    state.userData.history.forEach(h => {
      if (h.unitId === unit.unit_id) {
        answeredCorrect = Math.max(answeredCorrect, h.correct || 0);
      }
    });

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
            <span>High-Yield Mastery</span>
            <span>${masteryPct}%</span>
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
            <span>Test</span>
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
  } else if (scope === 'UNIT') {
    for (const s of state.curriculum.subjects) {
      const u = s.units.find(x => x.unit_id === targetId);
      if (u) {
        pool.push(...u.questions);
        break;
      }
    }
  }

  // Filter if PYQ toggle is on
  pool = getFilteredQuestions(pool);

  if (pool.length === 0) {
    alert("No questions found for the selected filter and scope.");
    return;
  }

  // Shuffle pool thoroughly
  state.activeQuestions = shuffleArray([...pool]);
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

  document.getElementById('quiz-unit-title').textContent = `⚡ Rapid Fire Drill (${scope})`;
  document.getElementById('quiz-unit-subtitle').textContent = `Infinite Random Questions • End anytime`;

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
    switchView('rapid-fire');
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
    title: `Rapid Fire (${state.rfScope})`,
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
  state.userAnswers = {};
  state.markedForReview = {};
  state.elapsedSeconds = 0;

  const configs = {
    'NEET_PG_FULL': { name: 'NEET PG Full Grand Test', count: 200, durationMins: 210, pos: 4, neg: 1, maxMarks: 800 },
    'NEET_PG_MINI': { name: 'NEET PG Mini-GT', count: 50, durationMins: 50, pos: 4, neg: 1, maxMarks: 200 },
    'INICET_FULL': { name: 'INI-CET Full Grand Test', count: 200, durationMins: 180, pos: 1, neg: 0.33, maxMarks: 200 },
    'INICET_MINI': { name: 'INI-CET Mini-GT', count: 50, durationMins: 45, pos: 1, neg: 0.33, maxMarks: 50 }
  };

  const cfg = configs[examType];
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

    if (isAnswered) answeredCount++;

    let style = "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200";
    if (isAnswered && !isMarked) style = "bg-emerald-600 text-white font-bold border border-emerald-700";
    if (isMarked && !isAnswered) style = "bg-purple-600 text-white font-bold border border-purple-700";
    if (isAnswered && isMarked) style = "bg-amber-500 text-white font-bold border border-amber-600";
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

      // Register mistakes into 20th Notebook and Spaced Repetition queue
      recordMistake(q, sId, chosen);
      scheduleSrsReview(q.id, sId, false);
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
  state.quizMode = 'UNIT';
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
  document.getElementById('quiz-unit-subtitle').textContent = `Diagnostic Unit Test • ${state.activeQuestions.length} Questions`;

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
    openImageModal(q.image_url, `${q.exam_source || 'Clinical Image'} • ${q.topic || ''}`);
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
  const q = state.activeQuestions[state.currentQIndex];
  if (!q) return;

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
      imgElem.alt = q.image_alt || 'Question image';
      credit.textContent = q.image_credit ? 'Image: ' + q.image_credit : '';
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
      scheduleSrsReview(q.id, sId, false);
    }

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
  if (confirm("Are you sure you want to exit the current test?")) {
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
function submitQuiz() {
  stopTimer();
  const total = state.activeQuestions.length;
  let correctCount = 0;
  let wrongCount = 0;

  state.activeQuestions.forEach(q => {
    const chosen = state.userAnswers[q.id];
    const sId = state.activeSubject ? state.activeSubject.subject_id : 'GENERAL';
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
    mode: 'UNIT',
    subjectId: state.activeSubject ? state.activeSubject.subject_id : '',
    unitId: state.activeUnit ? state.activeUnit.unit_id : '',
    title: state.activeUnit ? state.activeUnit.title : 'Unit Test',
    date: new Date().toISOString(),
    totalQuestions: total,
    correctCount: correctCount,
    wrongCount: wrongCount,
    elapsedSeconds: state.elapsedSeconds
  });
  saveUserData();

  // Populate Post-Test Banner
  document.getElementById('post-title').textContent = "Diagnostic Test Complete!";
  document.getElementById('post-badge').textContent = pct >= 70 ? "Mastery Achieved!" : "Needs Revision";
  document.getElementById('score-percent').textContent = `${pct}%`;
  document.getElementById('score-percent-label').textContent = "Score";
  document.getElementById('post-summary-text').textContent = 
    `You got ${correctCount} correct out of ${total} questions in ${formatTime(state.elapsedSeconds)}. All mistakes stay in your Daily Spaced Review queue until completed.`;

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
      let html = `<h5 class="text-xs font-bold uppercase tracking-wider text-amber-300 mb-2.5">${tbl.title}</h5>`;
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
        <div><b class="text-white">${m.name}:</b> ${m.expansion}</div>
      `;
      mnemonicsList.appendChild(li);
    });
  }
}

function renderReviewList(questions) {
  const container = document.getElementById('post-test-questions-list');
  container.innerHTML = '';

  questions.forEach((q, idx) => {
    const userChoice = state.userAnswers[q.id];
    const isCorrect = userChoice === q.correct_option;
    const card = document.createElement('div');
    card.className = `bg-white border rounded-2xl p-5 sm:p-6 shadow-sm space-y-4 ${
      isCorrect ? 'border-emerald-200 bg-emerald-50/20' : 'border-rose-200 bg-rose-50/20'
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
          <span class="w-6 h-6 rounded-full ${isCorrect ? 'bg-emerald-600' : 'bg-rose-600'} text-white flex items-center justify-center text-xs font-bold">
            ${idx + 1}
          </span>
          <span class="text-xs font-bold ${isCorrect ? 'text-emerald-700' : 'text-rose-700'}">
            ${isCorrect ? 'Correct (+4)' : 'Incorrect (-1)'}
          </span>
        </div>
        <span class="text-[11px] font-semibold text-slate-400">${q.exam_source}</span>
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
      ` : ''}

      <div class="space-y-2">
        ${optionsHtml}
      </div>

      <div class="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3.5 text-xs text-indigo-950 space-y-2">
        <div class="font-bold flex items-center space-x-1.5 text-indigo-900">
          <i data-lucide="book-open" class="w-3.5 h-3.5 text-indigo-600"></i>
          <span>Clinical Rationale</span>
        </div>
        <p class="leading-relaxed text-slate-700">${q.explanation.rationale}</p>
        
        <div class="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-amber-900 font-medium">
          <b class="text-amber-800">High-Yield Pearl:</b> ${q.explanation.high_yield_pearl}
        </div>

        ${distractorsHtml}
      </div>
    `;

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
function scheduleSrsReview(qId, subjectId, isCorrect) {
  let record = state.userData.srs[qId];
  const now = Date.now();

  if (!record) {
    record = {
      subjectId: subjectId,
      reps: 0,
      interval: 1, // days
      lastReviewedDate: new Date().toISOString(),
      nextReviewDate: new Date(now + 1 * 86400000).toISOString()
    };
  }

  if (isCorrect) {
    record.reps += 1;
    // Spaced progression: 1 -> 3 -> 7 -> 14 -> 30 days
    if (record.reps === 1) record.interval = 3;
    else if (record.reps === 2) record.interval = 7;
    else if (record.reps === 3) record.interval = 14;
    else record.interval = Math.min(60, record.interval * 2);
  } else {
    // Reset on error
    record.reps = 0;
    record.interval = 1;
  }

  record.lastReviewedDate = new Date().toISOString();
  record.nextReviewDate = new Date(now + record.interval * 86400000).toISOString();
  state.userData.srs[qId] = record;
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

  const dueList = getDueSrsQuestions();

  if (dueList.length === 0) {
    btnStart.classList.add('hidden');
    container.innerHTML = `
      <div class="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3">
        <div class="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center">
          <i data-lucide="check-circle" class="w-6 h-6"></i>
        </div>
        <h4 class="text-base font-bold text-slate-900">All Spaced Reviews Up to Date!</h4>
        <p class="text-xs text-slate-500 max-w-sm mx-auto">You have cleared all active review items. Questions you get wrong in Unit Tests or Grand Tests will appear here for timed daily recall.</p>
      </div>
    `;
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
      : `<span class="bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-md animate-pulse">Overdue by ${item.daysOverdue} Days</span>`;

    card.innerHTML = `
      <div class="space-y-1 min-w-0">
        <div class="flex items-center space-x-2">
          ${overdueBadge}
          <span class="text-[11px] font-semibold text-slate-400">${item.subjectId}</span>
          <span class="text-[11px] text-slate-400">• ${q.exam_source}</span>
        </div>
        <h5 class="text-xs sm:text-sm font-semibold text-slate-900 truncate">${q.question}</h5>
        <p class="text-[11px] text-slate-500 line-clamp-1">${q.explanation.rationale}</p>
      </div>

      <button onclick="startSingleQuestionDrill('${q.id}')" class="px-3 py-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 rounded-xl text-xs font-bold transition shrink-0">
        Review
      </button>
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
  const due = getDueSrsQuestions();
  if (due.length === 0) return;

  state.quizMode = 'SRS';
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
  const q = findQuestionById(qId);
  if (!q) return;

  state.quizMode = 'SRS';
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
  const container = document.getElementById('notebook-container');
  const pillsContainer = document.getElementById('notebook-subject-pills');
  if (!container || !pillsContainer) return;

  const mistakes = Object.values(state.userData.mistakes);

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
        <span class="text-[11px] text-slate-400">${new Date(m.lastWrongDate).toLocaleDateString()}</span>
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
      ` : ''}

      <div class="bg-rose-50 border border-rose-100 rounded-xl p-3 text-xs text-rose-950 space-y-1.5">
        <div class="flex items-center justify-between font-bold">
          <span class="text-rose-700">Your Answer: Option ${m.userChoice || 'Unattempted'}</span>
          <span class="text-emerald-700 font-bold">Correct: Option ${q.correct_option} (${q.options[q.correct_option]})</span>
        </div>
        <p class="text-slate-700">${q.explanation.rationale}</p>
        <div class="bg-amber-100/70 border border-amber-200 rounded-lg p-2.5 text-amber-950 font-semibold text-[11px]">
          <b>20th-Notebook Pearl:</b> ${q.explanation.high_yield_pearl}
        </div>
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
function renderTheoryVault() {
  const pillsContainer = document.getElementById('theory-filter-pills');
  const contentContainer = document.getElementById('theory-vault-container');
  if (!pillsContainer || !contentContainer || !state.curriculum) return;

  pillsContainer.innerHTML = '';
  contentContainer.innerHTML = '';

  // Render subject pills
  state.curriculum.subjects.forEach(subj => {
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

  const activeSubjectId = state.selectedTheorySubjectId || state.curriculum.subjects[0].subject_id;
  const activeSubj = state.curriculum.subjects.find(s => s.subject_id === activeSubjectId);
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
            <h5 class="text-xs font-bold uppercase tracking-wider text-slate-800 mb-2">${tbl.title}</h5>
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
            ${theory.high_yield_mnemonics.map(m => `<li><b>${m.name}:</b> ${m.expansion}</li>`).join('')}
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
          <span>Test Unit</span>
          <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
        </button>
      </div>

      <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">${theory.summary}</p>
      ${tablesHtml}
      ${mnemonicsHtml}
    `;

    contentContainer.appendChild(card);
  });

  lucide.createIcons();
}

function filterTheorySearch() {
  const query = (document.getElementById('theory-search')?.value || '').toLowerCase().trim();
  const cards = document.querySelectorAll('#theory-vault-container > div');
  cards.forEach(c => {
    const text = c.textContent.toLowerCase();
    c.style.display = text.includes(query) ? '' : 'none';
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
  if (container && popover && !container.contains(e.target) && !popover.classList.contains('hidden')) {
    popover.classList.add('hidden');
    const icon = document.getElementById('fab-icon');
    if (icon) {
      icon.setAttribute('data-lucide', 'sliders');
      if (window.lucide) lucide.createIcons();
    }
  }
});

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
