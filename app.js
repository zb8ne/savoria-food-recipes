/**
 * Savoria — Interactive Recipe Explorer, Dynamic Ingredient Scaler & Step-by-Step Cook Mode
 * Powered by the Savoria PHP REST API (`api/recipes.php`, `api/favorites.php`, `api/reviews.php`)
 * with automatic local fallback when opened directly via `file://`.
 */
(function () {
  "use strict";

  const STORAGE_KEYS = {
    FAVORITES: "savoria_saved_recipes_v1",
    CUSTOM_RECIPES: "savoria_custom_recipes_v1",
    THEME: "savoria_theme_v1",
    CLIENT_TOKEN: "savoria_client_token_v1",
    LOCAL_REVIEWS: "savoria_local_reviews_v1"
  };

  const API_BASE = "api";

  // Application State
  const state = {
    apiConnected: false,
    apiDriver: "",
    clientToken: "",

    recipes: [],
    favorites: new Set(),
    searchQuery: "",
    activeCategory: "All",
    onlySaved: false,
    quickUnder30: false,
    onlyVegetarian: false,
    sortBy: "featured",

    // Active Recipe Detail Modal State
    activeRecipeId: null,
    currentServings: 4,
    checkedIngredients: new Set(),
    completedSteps: new Set(),

    // Step Timers: key `${recipeId}-${stepIdx}` -> { remainingSec, totalSec, intervalId, running }
    timers: {},

    // Cook Mode State
    cookModeActive: false,
    cookStepIndex: 0
  };

  // DOM Elements
  const dom = {
    html: document.documentElement,
    brandReset: document.getElementById("brandReset"),
    searchInput: document.getElementById("searchInput"),
    favoritesFilterBtn: document.getElementById("favoritesFilterBtn"),
    savedCountBadge: document.getElementById("savedCountBadge"),
    openAddRecipeBtn: document.getElementById("openAddRecipeBtn"),
    themeToggleBtn: document.getElementById("themeToggleBtn"),

    heroSection: document.getElementById("heroSection"),
    heroCard: document.getElementById("heroCard"),
    resultsSummary: document.getElementById("resultsSummary"),
    categoryBar: document.getElementById("categoryBar"),
    sortSelect: document.getElementById("sortSelect"),
    recipeGrid: document.getElementById("recipeGrid"),
    emptyState: document.getElementById("emptyState"),
    resetFiltersBtn: document.getElementById("resetFiltersBtn"),
    footerStats: document.getElementById("footerStats"),

    // Detail Modal
    recipeModalBackdrop: document.getElementById("recipeModalBackdrop"),
    closeModalBtn: document.getElementById("closeModalBtn"),
    deleteCustomRecipeBtn: document.getElementById("deleteCustomRecipeBtn"),
    modalFavoriteBtn: document.getElementById("modalFavoriteBtn"),
    modalFavoriteText: document.getElementById("modalFavoriteText"),
    printRecipeBtn: document.getElementById("printRecipeBtn"),
    startCookModeBtn: document.getElementById("startCookModeBtn"),
    modalBodyContent: document.getElementById("modalBodyContent"),

    // Cook Mode
    cookModeOverlay: document.getElementById("cookModeOverlay"),
    cookModeTitle: document.getElementById("cookModeTitle"),
    toggleCookIngredientsBtn: document.getElementById("toggleCookIngredientsBtn"),
    exitCookModeBtn: document.getElementById("exitCookModeBtn"),
    cookProgressFill: document.getElementById("cookProgressFill"),
    cookIngredientsDrawer: document.getElementById("cookIngredientsDrawer"),
    cookServingsLabel: document.getElementById("cookServingsLabel"),
    cookIngredientsList: document.getElementById("cookIngredientsList"),
    cookStepCard: document.getElementById("cookStepCard"),
    cookStepCounter: document.getElementById("cookStepCounter"),
    prevStepBtn: document.getElementById("prevStepBtn"),
    nextStepBtn: document.getElementById("nextStepBtn"),

    // Add Recipe Modal
    addRecipeBackdrop: document.getElementById("addRecipeBackdrop"),
    closeAddRecipeBtn: document.getElementById("closeAddRecipeBtn"),
    cancelAddRecipeBtn: document.getElementById("cancelAddRecipeBtn"),
    addRecipeForm: document.getElementById("addRecipeForm"),

    toastContainer: document.getElementById("toastContainer")
  };

  /* ==========================================================================
     Utilities & Formatting
     ========================================================================== */

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatAmount(amount) {
    if (amount === null || amount === undefined || isNaN(amount) || amount <= 0) {
      return "";
    }
    const rounded = Math.round(amount * 100) / 100;
    const whole = Math.floor(rounded);
    const rem = rounded - whole;

    const fractions = [
      { val: 0, sym: "" },
      { val: 0.125, sym: "⅛" },
      { val: 0.25, sym: "¼" },
      { val: 0.333, sym: "⅓" },
      { val: 0.5, sym: "½" },
      { val: 0.667, sym: "⅔" },
      { val: 0.75, sym: "¾" },
      { val: 1, sym: "" }
    ];

    let best = fractions[0];
    let minDiff = Math.abs(rem - best.val);
    for (const f of fractions) {
      const diff = Math.abs(rem - f.val);
      if (diff < minDiff) {
        minDiff = diff;
        best = f;
      }
    }

    if (minDiff <= 0.06) {
      if (best.val === 1) return String(whole + 1);
      if (best.val === 0) return String(whole);
      return whole > 0 ? `${whole} ${best.sym}` : best.sym;
    }
    return Number(rounded.toFixed(1)).toString();
  }

  function formatSeconds(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function createFallbackSvg(title, accent = "#C8522B") {
    const safeTitle = escapeHtml(title.slice(0, 32));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${accent}"/>
          <stop offset="100%" stop-color="#2B211B"/>
        </linearGradient>
      </defs>
      <rect width="800" height="520" fill="url(#g)"/>
      <circle cx="400" cy="240" r="115" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="6"/>
      <circle cx="400" cy="240" r="88" fill="rgba(255,255,255,0.12)"/>
      <text x="400" y="425" text-anchor="middle" fill="#FAF7F2" font-family="Georgia, serif" font-size="30" font-weight="bold">${safeTitle}</text>
    </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function showToast(message) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    dom.toastContainer.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 2800);
  }

  function playTimerChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.16);
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.16 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.16 + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.16);
        osc.stop(ctx.currentTime + i * 0.16 + 0.5);
      });
    } catch (_) {
      // Ignore audio errors if blocked
    }
  }

  /* ==========================================================================
     PHP API Client & Fallback Persistence
     ========================================================================== */

  function ensureClientToken() {
    let token = localStorage.getItem(STORAGE_KEYS.CLIENT_TOKEN);
    if (!token) {
      token = "cook_" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      localStorage.setItem(STORAGE_KEYS.CLIENT_TOKEN, token);
    }
    state.clientToken = token;
  }

  async function apiFetch(endpoint, options = {}) {
    const headers = Object.assign(
      {
        "Content-Type": "application/json",
        "X-Client-Token": state.clientToken
      },
      options.headers || {}
    );
    const response = await fetch(`${API_BASE}/${endpoint}`, {
      ...options,
      headers
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
  }

  function loadLocalFallbackData() {
    try {
      const savedFavs = JSON.parse(localStorage.getItem(STORAGE_KEYS.FAVORITES) || "[]");
      state.favorites = new Set(Array.isArray(savedFavs) ? savedFavs : []);
    } catch (_) {
      state.favorites = new Set();
    }

    let custom = [];
    try {
      const rawCustom = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_RECIPES) || "[]");
      if (Array.isArray(rawCustom)) custom = rawCustom;
    } catch (_) {
      custom = [];
    }

    let localReviews = {};
    try {
      localReviews = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCAL_REVIEWS) || "{}") || {};
    } catch (_) {
      localReviews = {};
    }

    state.recipes = [...custom, ...(window.INITIAL_RECIPES || [])].map((r) => ({
      ...r,
      recentReviews: localReviews[r.id] || r.recentReviews || []
    }));
  }

  function initTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
    if (savedTheme === "dark" || savedTheme === "light") {
      dom.html.setAttribute("data-theme", savedTheme);
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      dom.html.setAttribute("data-theme", "dark");
    }
  }

  async function bootstrapData() {
    ensureClientToken();
    initTheme();

    // Render immediate local snapshot first for zero-latency paint
    loadLocalFallbackData();
    renderAll();

    if (window.location.protocol === "file:") {
      return;
    }

    try {
      const [health, payload] = await Promise.all([
        apiFetch("health.php"),
        apiFetch("recipes.php")
      ]);
      state.apiConnected = true;
      state.apiDriver = health.driver || "sqlite";
      state.recipes = Array.isArray(payload.recipes) ? payload.recipes : [];
      state.favorites = new Set(Array.isArray(payload.favorites) ? payload.favorites : []);
      renderAll();
    } catch (_) {
      // Static HTTP server without PHP runtime: keep local fallback seamlessly
      state.apiConnected = false;
      renderAll();
    }
  }

  async function toggleFavorite(recipeId) {
    if (state.apiConnected) {
      try {
        const res = await apiFetch("favorites.php", {
          method: "POST",
          body: JSON.stringify({ recipeId })
        });
        state.favorites = new Set(res.favorites || []);
        showToast(res.saved ? "Saved to your recipe box" : "Removed from Saved Recipes");
      } catch (err) {
        showToast(err.message || "Could not update saved recipes");
        return;
      }
    } else {
      if (state.favorites.has(recipeId)) {
        state.favorites.delete(recipeId);
        showToast("Removed from Saved Recipes");
      } else {
        state.favorites.add(recipeId);
        showToast("Saved to your recipe box");
      }
      localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify([...state.favorites]));
    }

    renderAll();
    if (state.activeRecipeId === recipeId) {
      syncModalFavoriteButton(recipeId);
    }
  }

  /* ==========================================================================
     Filtering, Sorting & Rendering Home View
     ========================================================================== */

  function getCategories() {
    const counts = new Map();
    state.recipes.forEach((r) => {
      counts.set(r.category, (counts.get(r.category) || 0) + 1);
    });
    return ["All", ...counts.keys()];
  }

  function getFilteredRecipes() {
    const q = state.searchQuery.trim().toLowerCase();

    const filtered = state.recipes.filter((r) => {
      if (state.onlySaved && !state.favorites.has(r.id)) return false;
      if (state.activeCategory !== "All" && r.category !== state.activeCategory) return false;
      if (state.quickUnder30 && r.prepTime + r.cookTime > 30) return false;
      if (state.onlyVegetarian && !r.vegetarian) return false;

      if (q) {
        const inTitle = r.title.toLowerCase().includes(q);
        const inCuisine = r.cuisine.toLowerCase().includes(q);
        const inDesc = r.description.toLowerCase().includes(q);
        const inTags = (r.tags || []).some((t) => t.toLowerCase().includes(q));
        const inIng = (r.ingredients || []).some((ing) => ing.item.toLowerCase().includes(q));
        if (!(inTitle || inCuisine || inDesc || inTags || inIng)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (state.sortBy === "rating") return (b.rating || 0) - (a.rating || 0);
      if (state.sortBy === "time-asc") return a.prepTime + a.cookTime - (b.prepTime + b.cookTime);
      if (state.sortBy === "calories-asc") {
        return (a.nutrition?.calories || 9999) - (b.nutrition?.calories || 9999);
      }
      return Number(Boolean(b.featured)) - Number(Boolean(a.featured));
    });

    return filtered;
  }

  function renderHero() {
    const isFiltering =
      state.searchQuery.trim() !== "" ||
      state.activeCategory !== "All" ||
      state.onlySaved ||
      state.quickUnder30 ||
      state.onlyVegetarian;

    if (isFiltering) {
      dom.heroSection.classList.add("hidden");
      return;
    }

    const featured = state.recipes.find((r) => r.featured) || state.recipes[0];
    if (!featured) {
      dom.heroSection.classList.add("hidden");
      return;
    }

    dom.heroSection.classList.remove("hidden");
    const totalTime = featured.prepTime + featured.cookTime;
    const isSaved = state.favorites.has(featured.id);
    const fallbackSrc = createFallbackSvg(featured.title, featured.accentColor);
    const imgSrc = featured.image || fallbackSrc;

    dom.heroCard.innerHTML = `
      <div class="hero-content">
        <span class="hero-eyebrow">Chef's Spotlight &bull; ${escapeHtml(featured.cuisine)}</span>
        <h2 class="hero-title">${escapeHtml(featured.title)}</h2>
        <p class="hero-desc">${escapeHtml(featured.description)}</p>
        <div class="hero-meta">
          <span class="hero-meta-item">⏱ ${totalTime} mins total</span>
          <span class="hero-meta-item">🍽 ${featured.servings} servings</span>
          <span class="hero-meta-item">🔥 ${featured.nutrition?.calories || 480} kcal</span>
          <span class="hero-meta-item">★ ${Number(featured.rating).toFixed(1)} (${featured.reviews})</span>
        </div>
        <div class="hero-actions">
          <button type="button" class="btn btn-primary btn-lg" data-open-recipe="${escapeHtml(featured.id)}">
            View Recipe &amp; Cook
          </button>
          <button type="button" class="btn btn-ghost btn-lg" data-fav-recipe="${escapeHtml(featured.id)}" aria-pressed="${isSaved}">
            ${isSaved ? "♥ Saved" : "♡ Save Recipe"}
          </button>
        </div>
      </div>
      <div class="hero-media">
        <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(featured.title)}" data-fallback="${escapeHtml(fallbackSrc)}" />
      </div>
    `;
  }

  function renderCategories() {
    const categories = getCategories();
    dom.categoryBar.innerHTML = categories
      .map((cat) => {
        const active = state.activeCategory === cat;
        return `<button type="button" role="tab" aria-selected="${active}" class="category-pill ${active ? "active" : ""}" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`;
      })
      .join("");
  }

  function renderGrid() {
    const filtered = getFilteredRecipes();
    const totalCount = state.recipes.length;

    dom.savedCountBadge.textContent = String(state.favorites.size);
    dom.favoritesFilterBtn.setAttribute("aria-pressed", String(state.onlySaved));

    const apiBadge = state.apiConnected
      ? `<span class="api-status-pill online">● PHP API (${escapeHtml(state.apiDriver.toUpperCase())})</span>`
      : `<span class="api-status-pill">Local Mode</span>`;
    dom.footerStats.innerHTML = `<span>${totalCount} recipes &bull; ${state.favorites.size} saved</span> ${apiBadge}`;

    if (filtered.length === totalCount) {
      dom.resultsSummary.textContent = `Showing all ${totalCount} kitchen-tested recipes`;
    } else {
      dom.resultsSummary.textContent = `Showing ${filtered.length} of ${totalCount} recipes`;
    }

    if (filtered.length === 0) {
      dom.recipeGrid.innerHTML = "";
      dom.emptyState.classList.remove("hidden");
      return;
    }

    dom.emptyState.classList.add("hidden");

    dom.recipeGrid.innerHTML = filtered
      .map((r) => {
        const totalTime = r.prepTime + r.cookTime;
        const isSaved = state.favorites.has(r.id);
        const fallbackSrc = createFallbackSvg(r.title, r.accentColor);
        const imgSrc = r.image || fallbackSrc;

        return `
          <article class="recipe-card" data-card-id="${escapeHtml(r.id)}">
            <div class="card-media" data-open-recipe="${escapeHtml(r.id)}">
              <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(r.title)}" loading="lazy" data-fallback="${escapeHtml(fallbackSrc)}" />
              <div class="card-badges">
                <span class="card-badge">${escapeHtml(r.category)}</span>
                ${r.vegetarian ? `<span class="card-badge veg">Vegetarian</span>` : ""}
              </div>
              <button
                type="button"
                class="card-fav-btn ${isSaved ? "saved" : ""}"
                data-fav-recipe="${escapeHtml(r.id)}"
                aria-label="${isSaved ? "Remove from saved recipes" : "Save recipe"}"
                title="${isSaved ? "Saved" : "Save recipe"}"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                </svg>
              </button>
            </div>

            <div class="card-body">
              <div class="card-subline">
                <span>${escapeHtml(r.cuisine)} &bull; ${escapeHtml(r.difficulty)}</span>
                <span class="card-rating" aria-label="Rated ${r.rating} out of 5">★ ${Number(r.rating).toFixed(1)}</span>
              </div>
              <h2 class="card-title" data-open-recipe="${escapeHtml(r.id)}">${escapeHtml(r.title)}</h2>
              <p class="card-desc">${escapeHtml(r.description)}</p>

              <div class="card-footer">
                <div class="card-stats">
                  <span>⏱ ${totalTime}m</span>
                  <span>🍽 ${r.servings}</span>
                  <span>${r.nutrition?.calories || 450} kcal</span>
                </div>
                <button type="button" class="card-open-link" data-open-recipe="${escapeHtml(r.id)}">
                  Cook &rarr;
                </button>
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderAll() {
    renderHero();
    renderCategories();
    renderGrid();
  }

  /* ==========================================================================
     Recipe Detail Modal, Serving Scaler, Reviews & Step Timers
     ========================================================================== */

  function getActiveRecipe() {
    return state.recipes.find((r) => r.id === state.activeRecipeId) || null;
  }

  async function openRecipeModal(recipeId) {
    let recipe = state.recipes.find((r) => r.id === recipeId);
    if (!recipe) return;

    state.activeRecipeId = recipe.id;
    state.currentServings = recipe.servings;
    state.checkedIngredients = new Set();
    state.completedSteps = new Set();

    syncModalFavoriteButton(recipe.id);
    dom.deleteCustomRecipeBtn.classList.toggle("hidden", !recipe.isCustom);
    renderModalContent();

    dom.recipeModalBackdrop.classList.remove("hidden");
    document.body.classList.add("modal-open");
    dom.closeModalBtn.focus();

    // Refresh latest recipe + reviews from PHP backend if connected
    if (state.apiConnected) {
      try {
        const res = await apiFetch(`recipes.php?id=${encodeURIComponent(recipeId)}`);
        if (res.recipe) {
          const idx = state.recipes.findIndex((r) => r.id === recipeId);
          if (idx !== -1) state.recipes[idx] = res.recipe;
          if (state.activeRecipeId === recipeId) {
            dom.deleteCustomRecipeBtn.classList.toggle("hidden", !res.recipe.isCustom);
            renderModalContent();
          }
        }
      } catch (_) {
        // Keep cached recipe if network hiccups
      }
    }
  }

  function closeRecipeModal() {
    dom.recipeModalBackdrop.classList.add("hidden");
    if (!state.cookModeActive) {
      document.body.classList.remove("modal-open");
    }
    state.activeRecipeId = null;
  }

  function syncModalFavoriteButton(recipeId) {
    const saved = state.favorites.has(recipeId);
    dom.modalFavoriteBtn.setAttribute("aria-pressed", String(saved));
    dom.modalFavoriteText.textContent = saved ? "Saved" : "Save";
  }

  function getScaledIngredientText(ing, baseServings, targetServings) {
    const ratio = targetServings / baseServings;
    const scaled = ing.amount ? formatAmount(ing.amount * ratio) : "";
    const unit = ing.unit ? `${ing.unit} ` : "";
    return {
      qtyPart: `${scaled}${scaled ? " " : ""}${unit}`.trim(),
      itemPart: ing.item
    };
  }

  function renderModalContent() {
    const r = getActiveRecipe();
    if (!r) return;

    const totalTime = r.prepTime + r.cookTime;
    const fallbackSrc = createFallbackSvg(r.title, r.accentColor);
    const imgSrc = r.image || fallbackSrc;

    const doneCount = state.completedSteps.size;
    const totalSteps = r.steps.length;
    const pct = totalSteps ? Math.round((doneCount / totalSteps) * 100) : 0;
    const recentReviews = r.recentReviews || [];

    dom.modalBodyContent.innerHTML = `
      <div class="detail-hero">
        <div class="detail-photo-wrap">
          <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(r.title)}" data-fallback="${escapeHtml(fallbackSrc)}" />
        </div>
        <div>
          <div class="detail-tags">
            <span class="detail-tag">${escapeHtml(r.category)}</span>
            <span class="detail-tag">${escapeHtml(r.cuisine)}</span>
            ${(r.tags || []).map((t) => `<span class="detail-tag">${escapeHtml(t)}</span>`).join("")}
          </div>
          <h2 id="modalRecipeTitle" class="detail-title">${escapeHtml(r.title)}</h2>
          <p class="detail-desc">${escapeHtml(r.description)}</p>

          <div class="detail-metrics">
            <div class="metric-box">
              <span class="metric-label">Prep</span>
              <span class="metric-val">${r.prepTime} min</span>
            </div>
            <div class="metric-box">
              <span class="metric-label">Cook</span>
              <span class="metric-val">${r.cookTime} min</span>
            </div>
            <div class="metric-box">
              <span class="metric-label">Total</span>
              <span class="metric-val">${totalTime} min</span>
            </div>
            <div class="metric-box">
              <span class="metric-label">Rating</span>
              <span class="metric-val">★ ${Number(r.rating).toFixed(1)} (${r.reviews})</span>
            </div>
          </div>

          <div class="nutrition-strip" aria-label="Nutrition per serving">
            <span><strong>Nutrition / serving:</strong></span>
            <span>${r.nutrition?.calories || 460} kcal</span>
            <span>Protein ${escapeHtml(r.nutrition?.protein || "18g")}</span>
            <span>Carbs ${escapeHtml(r.nutrition?.carbs || "42g")}</span>
            <span>Fat ${escapeHtml(r.nutrition?.fat || "19g")}</span>
          </div>
        </div>
      </div>

      ${
        r.chefNote
          ? `<div class="chef-note-banner"><strong>Chef's Tip:</strong> ${escapeHtml(r.chefNote)}</div>`
          : ""
      }

      <div class="detail-columns">
        <!-- Left: Dynamic Ingredients & Scaler -->
        <aside class="ingredients-panel" aria-label="Recipe ingredients">
          <div class="panel-header">
            <h3 class="panel-title">Ingredients</h3>
            <div class="servings-scaler" role="group" aria-label="Adjust servings">
              <button type="button" class="scaler-btn" id="decServingsBtn" aria-label="Decrease servings" ${
                state.currentServings <= 1 ? "disabled" : ""
              }>&minus;</button>
              <span class="scaler-value" id="servingsValueLabel">${state.currentServings} servings</span>
              <button type="button" class="scaler-btn" id="incServingsBtn" aria-label="Increase servings" ${
                state.currentServings >= 16 ? "disabled" : ""
              }>+</button>
            </div>
          </div>

          <ul class="ingredient-list" id="modalIngredientList">
            ${r.ingredients
              .map((ing, idx) => {
                const { qtyPart, itemPart } = getScaledIngredientText(ing, r.servings, state.currentServings);
                const checked = state.checkedIngredients.has(idx);
                return `
                  <li class="ingredient-item">
                    <label class="ingredient-label ${checked ? "checked" : ""}">
                      <input type="checkbox" data-ing-idx="${idx}" ${checked ? "checked" : ""} />
                      <span>
                        ${qtyPart ? `<strong class="ing-qty">${escapeHtml(qtyPart)}</strong> ` : ""}${escapeHtml(itemPart)}
                      </span>
                    </label>
                  </li>
                `;
              })
              .join("")}
          </ul>

          <button type="button" class="btn btn-outline btn-sm" id="copyIngredientsBtn" style="width: 100%;">
            Copy Shopping List
          </button>
        </aside>

        <!-- Right: Step-by-Step Instructions -->
        <section class="instructions-panel" aria-label="Step-by-step cooking instructions">
          <div class="panel-header">
            <h3 class="panel-title">Step-by-Step Instructions</h3>
          </div>

          <div class="steps-progress-row">
            <div class="steps-progress-bar" aria-hidden="true">
              <div class="steps-progress-fill" id="modalStepsProgressFill" style="width: ${pct}%;"></div>
            </div>
            <span class="steps-progress-text" id="modalStepsProgressText">${doneCount} of ${totalSteps} completed</span>
          </div>

          <ol class="step-list" id="modalStepList">
            ${r.steps
              .map((step, idx) => {
                const isDone = state.completedSteps.has(idx);
                const timerKey = `${r.id}-${idx}`;
                const timerObj = state.timers[timerKey];
                const defaultSec = (step.timerMinutes || 0) * 60;
                const displaySec = timerObj ? timerObj.remainingSec : defaultSec;
                const isRunning = Boolean(timerObj && timerObj.running);
                const isFinished = Boolean(timerObj && timerObj.remainingSec === 0);

                return `
                  <li class="step-card ${isDone ? "completed" : ""}" data-step-card="${idx}">
                    <div class="step-top">
                      <div class="step-heading-wrap">
                        <span class="step-number">${idx + 1}</span>
                        <h4 class="step-title">${escapeHtml(step.title || `Step ${idx + 1}`)}</h4>
                      </div>
                      <button type="button" class="step-check-btn" data-toggle-step="${idx}">
                        ${isDone ? "✓ Done" : "Mark Done"}
                      </button>
                    </div>
                    <p class="step-text">${escapeHtml(step.instruction)}</p>
                    ${step.tip ? `<div class="step-tip"><strong>Tip:</strong> ${escapeHtml(step.tip)}</div>` : ""}
                    ${
                      step.timerMinutes
                        ? `
                      <div class="timer-widget ${isRunning ? "running" : ""} ${isFinished ? "finished" : ""}" data-timer-key="${escapeHtml(timerKey)}">
                        <span>⏲</span>
                        <span class="timer-readout" data-timer-readout="${escapeHtml(timerKey)}">${formatSeconds(displaySec)}</span>
                        <button type="button" class="timer-action-btn" data-timer-toggle="${escapeHtml(timerKey)}" data-timer-mins="${step.timerMinutes}">
                          ${isRunning ? "Pause" : isFinished ? "Restart" : "Start Timer"}
                        </button>
                        <button type="button" class="timer-reset-btn" data-timer-reset="${escapeHtml(timerKey)}" data-timer-mins="${step.timerMinutes}">
                          Reset
                        </button>
                      </div>
                    `
                        : ""
                    }
                  </li>
                `;
              })
              .join("")}
          </ol>
        </section>
      </div>

      <!-- Community Reviews & Rating Section -->
      <section class="reviews-section" aria-label="Cook reviews">
        <h3 class="panel-title">Cook Notes &amp; Reviews</h3>
        <form id="submitReviewForm" class="review-form">
          <input type="text" id="reviewAuthorInput" placeholder="Your name (optional)" maxlength="80" />
          <select id="reviewStarsInput" aria-label="Star rating">
            <option value="5">★★★★★ (5/5)</option>
            <option value="4">★★★★☆ (4/5)</option>
            <option value="3">★★★☆☆ (3/5)</option>
            <option value="2">★★☆☆☆ (2/5)</option>
            <option value="1">★☆☆☆☆ (1/5)</option>
          </select>
          <button type="submit" class="btn btn-primary btn-sm">Post Review</button>
          <textarea id="reviewCommentInput" rows="2" required placeholder="Did you make any tweaks or substitutions? Share how it turned out..."></textarea>
        </form>

        <ul class="review-list">
          ${
            recentReviews.length > 0
              ? recentReviews
                  .map(
                    (rev) => `
              <li class="review-item">
                <div class="review-item-head">
                  <strong>${escapeHtml(rev.authorName)}</strong>
                  <span class="review-stars">${"★".repeat(rev.stars)}${"☆".repeat(5 - rev.stars)}</span>
                </div>
                <p class="review-comment">${escapeHtml(rev.comment)}</p>
              </li>
            `
                  )
                  .join("")
              : `<li class="review-item"><p class="review-comment">No cook notes yet — be the first to share how this recipe turned out!</p></li>`
          }
        </ul>
      </section>
    `;
  }

  /* ==========================================================================
     Kitchen Timer Engine
     ========================================================================== */

  function toggleTimer(timerKey, defaultMinutes) {
    let t = state.timers[timerKey];
    if (!t) {
      t = {
        totalSec: defaultMinutes * 60,
        remainingSec: defaultMinutes * 60,
        running: false,
        intervalId: null
      };
      state.timers[timerKey] = t;
    }

    if (t.remainingSec === 0) {
      t.remainingSec = t.totalSec;
    }

    if (t.running) {
      clearInterval(t.intervalId);
      t.intervalId = null;
      t.running = false;
    } else {
      t.running = true;
      t.intervalId = setInterval(() => {
        if (t.remainingSec > 0) {
          t.remainingSec -= 1;
          updateTimerDisplays(timerKey);
        }
        if (t.remainingSec <= 0) {
          clearInterval(t.intervalId);
          t.intervalId = null;
          t.running = false;
          playTimerChime();
          showToast("⏲ Kitchen timer complete!");
          updateTimerDisplays(timerKey);
        }
      }, 1000);
    }

    updateTimerDisplays(timerKey);
  }

  function resetTimer(timerKey, defaultMinutes) {
    const t = state.timers[timerKey];
    if (t && t.intervalId) {
      clearInterval(t.intervalId);
    }
    state.timers[timerKey] = {
      totalSec: defaultMinutes * 60,
      remainingSec: defaultMinutes * 60,
      running: false,
      intervalId: null
    };
    updateTimerDisplays(timerKey);
  }

  function updateTimerDisplays(timerKey) {
    const t = state.timers[timerKey];
    if (!t) return;

    document.querySelectorAll(`[data-timer-key="${timerKey}"]`).forEach((widget) => {
      widget.classList.toggle("running", t.running);
      widget.classList.toggle("finished", !t.running && t.remainingSec === 0);

      const readout = widget.querySelector(`[data-timer-readout="${timerKey}"]`);
      if (readout) readout.textContent = formatSeconds(t.remainingSec);

      const toggleBtn = widget.querySelector(`[data-timer-toggle="${timerKey}"]`);
      if (toggleBtn) {
        toggleBtn.textContent = t.running ? "Pause" : t.remainingSec === 0 ? "Restart" : "Start Timer";
      }
    });
  }

  /* ==========================================================================
     Full-Screen Step-by-Step Cook Mode
     ========================================================================== */

  function openCookMode() {
    const r = getActiveRecipe();
    if (!r) return;

    state.cookModeActive = true;
    state.cookStepIndex = 0;

    dom.cookModeTitle.textContent = r.title;
    dom.cookServingsLabel.textContent = String(state.currentServings);

    dom.cookIngredientsList.innerHTML = r.ingredients
      .map((ing) => {
        const { qtyPart, itemPart } = getScaledIngredientText(ing, r.servings, state.currentServings);
        return `<li>${qtyPart ? `<strong>${escapeHtml(qtyPart)}</strong> ` : ""}${escapeHtml(itemPart)}</li>`;
      })
      .join("");

    renderCookStep();
    dom.cookModeOverlay.classList.remove("hidden");
    document.body.classList.add("modal-open");
  }

  function closeCookMode() {
    state.cookModeActive = false;
    dom.cookModeOverlay.classList.add("hidden");
    dom.cookIngredientsDrawer.classList.add("hidden");
    dom.toggleCookIngredientsBtn.setAttribute("aria-expanded", "false");
    if (dom.recipeModalBackdrop.classList.contains("hidden")) {
      document.body.classList.remove("modal-open");
    }
  }

  function renderCookStep() {
    const r = getActiveRecipe();
    if (!r) return;

    const total = r.steps.length;
    const idx = Math.max(0, Math.min(state.cookStepIndex, total - 1));
    const step = r.steps[idx];

    const pct = ((idx + 1) / total) * 100;
    dom.cookProgressFill.style.width = `${pct}%`;
    dom.cookStepCounter.textContent = `Step ${idx + 1} of ${total}`;

    dom.prevStepBtn.disabled = idx === 0;
    dom.nextStepBtn.innerHTML =
      idx === total - 1
        ? "Finish Cooking ✓"
        : `Next Step <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

    const timerKey = `${r.id}-${idx}`;
    const timerObj = state.timers[timerKey];
    const defaultSec = (step.timerMinutes || 0) * 60;
    const displaySec = timerObj ? timerObj.remainingSec : defaultSec;
    const isRunning = Boolean(timerObj && timerObj.running);
    const isFinished = Boolean(timerObj && timerObj.remainingSec === 0);

    dom.cookStepCard.innerHTML = `
      <div class="cook-step-kicker">Step ${idx + 1} of ${total}</div>
      <h3 class="cook-step-heading">${escapeHtml(step.title || `Step ${idx + 1}`)}</h3>
      <p class="cook-step-instruction">${escapeHtml(step.instruction)}</p>
      ${step.tip ? `<div class="step-tip" style="margin-top: 1.25rem;"><strong>Chef's Tip:</strong> ${escapeHtml(step.tip)}</div>` : ""}
      ${
        step.timerMinutes
          ? `
        <div class="timer-widget ${isRunning ? "running" : ""} ${isFinished ? "finished" : ""}" style="margin-top: 1.5rem;" data-timer-key="${escapeHtml(timerKey)}">
          <span>⏲</span>
          <span class="timer-readout" data-timer-readout="${escapeHtml(timerKey)}">${formatSeconds(displaySec)}</span>
          <button type="button" class="timer-action-btn" data-timer-toggle="${escapeHtml(timerKey)}" data-timer-mins="${step.timerMinutes}">
            ${isRunning ? "Pause" : isFinished ? "Restart" : "Start Timer"}
          </button>
          <button type="button" class="timer-reset-btn" data-timer-reset="${escapeHtml(timerKey)}" data-timer-mins="${step.timerMinutes}">
            Reset
          </button>
        </div>
      `
          : ""
      }
    `;
  }

  /* ==========================================================================
     Add / Delete Custom Recipe & Reviews Flows
     ========================================================================== */

  function parseIngredientLine(line) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)\s+(.+)$/);
    if (match) {
      return {
        amount: parseFloat(match[1]),
        unit: match[2],
        item: match[3]
      };
    }
    const numOnly = trimmed.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
    if (numOnly) {
      return {
        amount: parseFloat(numOnly[1]),
        unit: "",
        item: numOnly[2]
      };
    }
    return { amount: null, unit: "", item: trimmed };
  }

  function parseStepLine(line, index) {
    const clean = line.trim().replace(/^\d+[\.\)]\s*/, "");
    const minMatch = clean.match(/(\d+)\s*(?:minutes|minute|mins|min)\b/i);
    return {
      title: `Step ${index + 1}`,
      instruction: clean,
      timerMinutes: minMatch ? parseInt(minMatch[1], 10) : undefined
    };
  }

  async function handleAddRecipeSubmit(e) {
    e.preventDefault();

    const title = document.getElementById("recipeTitleInput").value.trim();
    const category = document.getElementById("recipeCategoryInput").value;
    const cuisine = document.getElementById("recipeCuisineInput").value.trim();
    const prepTime = parseInt(document.getElementById("recipePrepInput").value, 10) || 15;
    const cookTime = parseInt(document.getElementById("recipeCookInput").value, 10) || 20;
    const servings = parseInt(document.getElementById("recipeServingsInput").value, 10) || 4;
    const calories = parseInt(document.getElementById("recipeCaloriesInput").value, 10) || 450;
    const difficulty = document.getElementById("recipeDifficultyInput").value;
    const vegetarian = document.getElementById("recipeVegetarianInput").checked;
    const image = document.getElementById("recipeImageInput").value.trim();
    const description = document.getElementById("recipeDescInput").value.trim();

    const ingLines = document
      .getElementById("recipeIngredientsInput")
      .value.split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const stepLines = document
      .getElementById("recipeStepsInput")
      .value.split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    if (!title || ingLines.length === 0 || stepLines.length === 0) {
      showToast("Please include a title, ingredients, and instructions.");
      return;
    }

    const recipePayload = {
      id: `custom-${Date.now()}`,
      title,
      category,
      cuisine: cuisine || "Home Kitchen",
      difficulty,
      prepTime,
      cookTime,
      servings,
      rating: 5.0,
      reviews: 1,
      featured: false,
      vegetarian,
      isCustom: true,
      tags: ["Custom Recipe", ...(vegetarian ? ["Vegetarian"] : [])],
      image: image || "",
      accentColor: "#C8522B",
      description,
      nutrition: { calories, protein: "—", carbs: "—", fat: "—" },
      ingredients: ingLines.map(parseIngredientLine),
      steps: stepLines.map(parseStepLine),
      recentReviews: []
    };

    let createdRecipe = recipePayload;

    if (state.apiConnected) {
      try {
        const res = await apiFetch("recipes.php", {
          method: "POST",
          body: JSON.stringify(recipePayload)
        });
        createdRecipe = res.recipe;
      } catch (err) {
        showToast(err.message || "Failed to save recipe to PHP server.");
        return;
      }
    } else {
      let customList = [];
      try {
        customList = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_RECIPES) || "[]");
      } catch (_) {
        customList = [];
      }
      customList.unshift(createdRecipe);
      localStorage.setItem(STORAGE_KEYS.CUSTOM_RECIPES, JSON.stringify(customList));
    }

    state.recipes.unshift(createdRecipe);
    dom.addRecipeForm.reset();
    dom.addRecipeBackdrop.classList.add("hidden");
    document.body.classList.remove("modal-open");

    renderAll();
    showToast(`Added "${createdRecipe.title}"!`);
    openRecipeModal(createdRecipe.id);
  }

  async function handleDeleteActiveCustomRecipe() {
    const r = getActiveRecipe();
    if (!r || !r.isCustom) return;

    if (state.apiConnected) {
      try {
        await apiFetch(`recipes.php?id=${encodeURIComponent(r.id)}`, {
          method: "DELETE"
        });
      } catch (err) {
        showToast(err.message || "Could not delete recipe");
        return;
      }
    } else {
      try {
        const customList = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_RECIPES) || "[]");
        const nextList = customList.filter((item) => item.id !== r.id);
        localStorage.setItem(STORAGE_KEYS.CUSTOM_RECIPES, JSON.stringify(nextList));
      } catch (_) {
        // ignore
      }
    }

    state.recipes = state.recipes.filter((item) => item.id !== r.id);
    state.favorites.delete(r.id);
    closeRecipeModal();
    renderAll();
    showToast("Custom recipe deleted");
  }

  async function handleReviewSubmit(e) {
    const form = e.target.closest("#submitReviewForm");
    if (!form) return;
    e.preventDefault();

    const r = getActiveRecipe();
    if (!r) return;

    const authorName = document.getElementById("reviewAuthorInput").value.trim() || "Home Cook";
    const stars = parseInt(document.getElementById("reviewStarsInput").value, 10) || 5;
    const comment = document.getElementById("reviewCommentInput").value.trim();
    if (!comment) return;

    if (state.apiConnected) {
      try {
        const res = await apiFetch("reviews.php", {
          method: "POST",
          body: JSON.stringify({
            recipeId: r.id,
            authorName,
            stars,
            comment
          })
        });
        const idx = state.recipes.findIndex((item) => item.id === r.id);
        if (idx !== -1 && res.recipe) {
          state.recipes[idx] = res.recipe;
        }
      } catch (err) {
        showToast(err.message || "Could not submit review");
        return;
      }
    } else {
      const newRev = {
        id: Date.now(),
        authorName,
        stars,
        comment,
        createdAt: new Date().toISOString()
      };
      const prevTotal = Number(r.rating) * Number(r.reviews);
      r.reviews = Number(r.reviews) + 1;
      r.rating = Math.round(((prevTotal + stars) / r.reviews) * 10) / 10;
      r.recentReviews = [newRev, ...(r.recentReviews || [])];

      try {
        const map = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCAL_REVIEWS) || "{}") || {};
        map[r.id] = r.recentReviews;
        localStorage.setItem(STORAGE_KEYS.LOCAL_REVIEWS, JSON.stringify(map));
      } catch (_) {
        // ignore
      }
    }

    renderAll();
    renderModalContent();
    showToast("Review posted — thank you!");
  }

  /* ==========================================================================
     Event Listeners & Delegation
     ========================================================================== */

  function bindEvents() {
    document.addEventListener(
      "error",
      (e) => {
        const target = e.target;
        if (target && target.tagName === "IMG" && target.dataset.fallback && target.src !== target.dataset.fallback) {
          target.src = target.dataset.fallback;
        }
      },
      true
    );

    dom.searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      renderAll();
    });

    dom.brandReset.addEventListener("click", (e) => {
      e.preventDefault();
      resetFilters();
    });

    dom.resetFiltersBtn.addEventListener("click", resetFilters);

    dom.favoritesFilterBtn.addEventListener("click", () => {
      state.onlySaved = !state.onlySaved;
      renderAll();
    });

    dom.themeToggleBtn.addEventListener("click", () => {
      const next = dom.html.getAttribute("data-theme") === "dark" ? "light" : "dark";
      dom.html.setAttribute("data-theme", next);
      localStorage.setItem(STORAGE_KEYS.THEME, next);
    });

    dom.categoryBar.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-category]");
      if (!btn) return;
      state.activeCategory = btn.dataset.category;
      renderAll();
    });

    document.querySelectorAll("[data-quick-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.quickFilter;
        if (type === "quick") {
          state.quickUnder30 = !state.quickUnder30;
          btn.setAttribute("aria-pressed", String(state.quickUnder30));
        } else if (type === "vegetarian") {
          state.onlyVegetarian = !state.onlyVegetarian;
          btn.setAttribute("aria-pressed", String(state.onlyVegetarian));
        }
        renderAll();
      });
    });

    dom.sortSelect.addEventListener("change", (e) => {
      state.sortBy = e.target.value;
      renderAll();
    });

    document.addEventListener("click", (e) => {
      const favBtn = e.target.closest("[data-fav-recipe]");
      if (favBtn) {
        e.stopPropagation();
        toggleFavorite(favBtn.dataset.favRecipe);
        return;
      }

      const openTrigger = e.target.closest("[data-open-recipe]");
      if (openTrigger) {
        openRecipeModal(openTrigger.dataset.openRecipe);
        return;
      }

      if (e.target.closest("#decServingsBtn")) {
        if (state.currentServings > 1) {
          state.currentServings -= 1;
          renderModalContent();
        }
        return;
      }
      if (e.target.closest("#incServingsBtn")) {
        if (state.currentServings < 16) {
          state.currentServings += 1;
          renderModalContent();
        }
        return;
      }

      if (e.target.closest("#copyIngredientsBtn")) {
        const r = getActiveRecipe();
        if (!r) return;
        const lines = r.ingredients.map((ing) => {
          const { qtyPart, itemPart } = getScaledIngredientText(ing, r.servings, state.currentServings);
          return `- ${qtyPart ? qtyPart + " " : ""}${itemPart}`;
        });
        const text = `${r.title} (${state.currentServings} servings)\n${lines.join("\n")}`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => showToast("Shopping list copied to clipboard!"));
        } else {
          showToast("Shopping list ready!");
        }
        return;
      }

      const stepBtn = e.target.closest("[data-toggle-step]");
      if (stepBtn) {
        const idx = parseInt(stepBtn.dataset.toggleStep, 10);
        if (state.completedSteps.has(idx)) {
          state.completedSteps.delete(idx);
        } else {
          state.completedSteps.add(idx);
        }
        renderModalContent();
        return;
      }

      const timerToggle = e.target.closest("[data-timer-toggle]");
      if (timerToggle) {
        toggleTimer(timerToggle.dataset.timerToggle, parseInt(timerToggle.dataset.timerMins, 10) || 1);
        return;
      }

      const timerReset = e.target.closest("[data-timer-reset]");
      if (timerReset) {
        resetTimer(timerReset.dataset.timerReset, parseInt(timerReset.dataset.timerMins, 10) || 1);
        return;
      }
    });

    dom.modalBodyContent.addEventListener("change", (e) => {
      const cb = e.target.closest("input[data-ing-idx]");
      if (!cb) return;
      const idx = parseInt(cb.dataset.ingIdx, 10);
      if (cb.checked) {
        state.checkedIngredients.add(idx);
      } else {
        state.checkedIngredients.delete(idx);
      }
      cb.closest(".ingredient-label")?.classList.toggle("checked", cb.checked);
    });

    dom.modalBodyContent.addEventListener("submit", handleReviewSubmit);

    // Detail Modal topbar actions
    dom.closeModalBtn.addEventListener("click", closeRecipeModal);
    dom.deleteCustomRecipeBtn.addEventListener("click", handleDeleteActiveCustomRecipe);
    dom.recipeModalBackdrop.addEventListener("click", (e) => {
      if (e.target === dom.recipeModalBackdrop) closeRecipeModal();
    });
    dom.modalFavoriteBtn.addEventListener("click", () => {
      if (state.activeRecipeId) toggleFavorite(state.activeRecipeId);
    });
    dom.printRecipeBtn.addEventListener("click", () => window.print());
    dom.startCookModeBtn.addEventListener("click", openCookMode);

    // Cook Mode controls
    dom.exitCookModeBtn.addEventListener("click", closeCookMode);
    dom.toggleCookIngredientsBtn.addEventListener("click", () => {
      const hidden = dom.cookIngredientsDrawer.classList.toggle("hidden");
      dom.toggleCookIngredientsBtn.setAttribute("aria-expanded", String(!hidden));
    });
    dom.prevStepBtn.addEventListener("click", () => {
      if (state.cookStepIndex > 0) {
        state.cookStepIndex -= 1;
        renderCookStep();
      }
    });
    dom.nextStepBtn.addEventListener("click", () => {
      const r = getActiveRecipe();
      if (!r) return;
      state.completedSteps.add(state.cookStepIndex);
      if (state.cookStepIndex < r.steps.length - 1) {
        state.cookStepIndex += 1;
        renderCookStep();
      } else {
        closeCookMode();
        renderModalContent();
        showToast("🎉 Dish complete — bon appétit!");
      }
    });

    // Add Recipe Modal
    dom.openAddRecipeBtn.addEventListener("click", () => {
      dom.addRecipeBackdrop.classList.remove("hidden");
      document.body.classList.add("modal-open");
      document.getElementById("recipeTitleInput").focus();
    });
    const closeAddModal = () => {
      dom.addRecipeBackdrop.classList.add("hidden");
      if (!state.activeRecipeId && !state.cookModeActive) {
        document.body.classList.remove("modal-open");
      }
    };
    dom.closeAddRecipeBtn.addEventListener("click", closeAddModal);
    dom.cancelAddRecipeBtn.addEventListener("click", closeAddModal);
    dom.addRecipeBackdrop.addEventListener("click", (e) => {
      if (e.target === dom.addRecipeBackdrop) closeAddModal();
    });
    dom.addRecipeForm.addEventListener("submit", handleAddRecipeSubmit);

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if (
        e.key === "/" &&
        document.activeElement.tagName !== "INPUT" &&
        document.activeElement.tagName !== "TEXTAREA" &&
        !state.activeRecipeId &&
        dom.addRecipeBackdrop.classList.contains("hidden")
      ) {
        e.preventDefault();
        dom.searchInput.focus();
        return;
      }

      if (e.key === "Escape") {
        if (state.cookModeActive) {
          closeCookMode();
        } else if (!dom.addRecipeBackdrop.classList.contains("hidden")) {
          closeAddModal();
        } else if (state.activeRecipeId) {
          closeRecipeModal();
        }
        return;
      }

      if (state.cookModeActive) {
        if (e.key === "ArrowRight") {
          dom.nextStepBtn.click();
        } else if (e.key === "ArrowLeft") {
          dom.prevStepBtn.click();
        }
      }
    });
  }

  function resetFilters() {
    state.searchQuery = "";
    state.activeCategory = "All";
    state.onlySaved = false;
    state.quickUnder30 = false;
    state.onlyVegetarian = false;
    state.sortBy = "featured";

    dom.searchInput.value = "";
    dom.sortSelect.value = "featured";
    document.querySelectorAll("[data-quick-filter]").forEach((b) => b.setAttribute("aria-pressed", "false"));
    renderAll();
  }

  // Boot
  bindEvents();
  bootstrapData();
})();
