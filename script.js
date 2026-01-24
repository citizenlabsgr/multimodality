// Load data from data.json
let appData = null;

async function loadData() {
  try {
    const response = await fetch("data.json");
    appData = await response.json();
  } catch (error) {
    console.error("Failed to load data.json:", error);
    // Fallback to default data if loading fails
    appData = {
      destination: "Van Andel Arena",
      validModes: [
        "drive",
        "rideshare",
        "transit",
        "micromobility",
        "shuttle",
        "bike",
      ],
      modeLabels: {
        drive: "driving",
        rideshare: "Uber/Lyft",
        transit: "The Rapid",
        bike: "biking",
        micromobility: "Lime",
        walk: "walking",
        shuttle: "DASH",
      },
      costLabels: {
        drive: "Willing to pay",
        rideshare: "Willing to pay",
        transit: "Willing to pay",
        bike: "Willing to pay",
        micromobility: "Willing to pay",
        walk: "Willing to pay",
        shuttle: "Willing to pay",
      },
      defaults: {
        flexibilityEarlyMins: 15,
        flexibilityLateMins: 0,
        people: 1,
        walkMiles: 0.5,
        parkingMins: 10,
        costDollars: 10,
      },
      defaultCosts: {
        micromobility: 4,
        transit: 1.75,
        rideshare: 15,
      },
    };
  }
}

// Calculate default time: current time + 2 hours, rounded to nearest half hour
// Minimum time is 5pm (17:00), maximum is 10pm (22:00)
function getDefaultTime() {
  const now = new Date();
  const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  let hour = twoHoursLater.getHours();
  let minutes = twoHoursLater.getMinutes();
  // Round to nearest half hour
  if (minutes < 15) {
    minutes = 0;
  } else if (minutes < 45) {
    minutes = 30;
  } else {
    minutes = 0;
    hour = (hour + 1) % 24;
  }
  // Ensure time is between 5pm and 10pm
  if (hour < 17) {
    hour = 17;
    minutes = 0;
  } else if (hour > 22 || (hour === 22 && minutes > 0)) {
    hour = 22;
    minutes = 0;
  }
  return String(hour).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
}

// Generate time options for dropdown (half-hour increments, starting at 5pm, ending at 10pm)
function generateTimeOptions() {
  const timeSelect = document.getElementById("timeSelect");
  const options = ['<option value="" disabled>---</option>']; // Add empty default option (disabled to show lighter color)
  // Start at 5pm (17:00) and go through 10pm (22:00)
  for (let hour = 17; hour <= 22; hour++) {
    for (let minute of [0, 30]) {
      // Skip 10:30pm, only go up to 10:00pm
      if (hour === 22 && minute === 30) break;
      const timeValue =
        String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
      const timeDisplay = new Date(
        `2000-01-01T${timeValue}`,
      ).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      options.push(`<option value="${timeValue}">${timeDisplay}</option>`);
    }
  }
  timeSelect.innerHTML = options.join("");
}

let state = null;
let validModes = null;

// Track if day/time/people/walk/pay have been changed from defaults
let dayChanged = false;
let timeChanged = false;
let peopleChanged = false;
let walkChanged = false;
let costChanged = false;

// Convert time from HH:MM (24-hour) to HMM or HHMM (12-hour without colon) for URL
// Times are 5pm-10pm, so we use 12-hour format: 17:00 -> "500", 20:30 -> "830", 22:00 -> "1000"
function timeToUrl(time) {
  const [hours, minutes] = time.split(":");
  const hour24 = parseInt(hours, 10);
  // Convert to 12-hour format (all times are PM since range is 5pm-10pm)
  const hour12 = hour24 > 12 ? hour24 - 12 : hour24;
  // Return without leading zero for single-digit hours (e.g., 8:30 PM -> "830", 5:00 PM -> "500")
  return hour12.toString() + minutes;
}

// Convert time from HMM or HHMM (12-hour) to HH:MM (24-hour) from URL
// All times are PM since the dropdown only has 5pm-10pm
function timeFromUrl(urlTime) {
  // Handle formats like "830" (8:30 PM = 20:30) or "500" (5:00 PM = 17:00) or "1000" (10:00 PM = 22:00)
  if (urlTime.length === 3) {
    // Format: HMM (e.g., "830" = 8:30 PM = 20:30)
    const hour12 = parseInt(urlTime[0], 10);
    const minutes = urlTime.slice(1);
    // All times are PM (5pm-10pm range)
    const hour24 = hour12 + 12;
    return hour24.toString().padStart(2, "0") + ":" + minutes;
  } else if (urlTime.length === 4) {
    // Format: HHMM (e.g., "1000" = 10:00 PM = 22:00)
    // Handle both 12-hour format (10-12) and 24-hour format (17-22) for backwards compatibility
    const hourPart = parseInt(urlTime.slice(0, 2), 10);
    const minutes = urlTime.slice(2);
    let hour24;
    if (hourPart >= 17 && hourPart <= 22) {
      // Already in 24-hour format (for backwards compatibility)
      hour24 = hourPart;
    } else if (hourPart >= 10 && hourPart <= 12) {
      // 10pm-12pm in 12-hour format
      hour24 = hourPart === 12 ? 12 : hourPart + 12;
    } else {
      // 5-9 in 12-hour format (should use 3-digit format, but handle 2-digit here too)
      hour24 = hourPart + 12;
    }
    return hour24.toString().padStart(2, "0") + ":" + minutes;
  }
  return urlTime; // Fallback if already in HH:MM format
}

// Base path for the destination (hash-based)
const DESTINATION_PATH = "/visit/van-andel-arena";

// Parse URL fragment (format: #/visit/van-andel-arena?modes=drive,transit&day=monday&time=1800&people=2)
function parseFragment() {
  const hash = window.location.hash.slice(1); // Remove the #
  if (!hash) return {};

  // Check if hash starts with a path (starts with /)
  let queryString = "";
  if (hash.startsWith("/")) {
    // Extract query string if present (after ?)
    const questionMarkIndex = hash.indexOf("?");
    if (questionMarkIndex !== -1) {
      queryString = hash.slice(questionMarkIndex + 1);
    }
  } else {
    // Legacy format: just query params without path
    queryString = hash;
  }

  if (!queryString) return {};

  const params = {};
  queryString.split("&").forEach((param) => {
    const [key, ...valueParts] = param.split("=");
    const value = valueParts.length > 0 ? valueParts.join("=") : undefined;
    if (key && value !== undefined) {
      if (key === "time") {
        // Convert time from URL format (HHMM) to state format (HH:MM)
        params[key] = timeFromUrl(decodeURIComponent(value));
      } else {
        params[key] = decodeURIComponent(value);
      }
    }
  });
  return params;
}

// Update URL fragment with current state
function updateFragment() {
  const parts = [];
  // Only include day/people in fragment if they've been changed by user
  if (dayChanged && state.day) {
    parts.push(`day=${encodeURIComponent(state.day)}`);
  }
  // Always include time in fragment if it's been selected
  if (state.time) {
    // Convert time to URL format without colon
    parts.push(`time=${timeToUrl(state.time)}`);
  }
  if (state.modes.length > 0) {
    parts.push(`modes=${state.modes.join(",")}`);
  }
  if (peopleChanged && state.people) {
    parts.push(`people=${encodeURIComponent(state.people)}`);
  }
  if (walkChanged && state.walkMiles !== undefined) {
    parts.push(`walk=${encodeURIComponent(state.walkMiles)}`);
  }
  if (costChanged && state.costDollars !== undefined) {
    parts.push(`pay=${encodeURIComponent(state.costDollars)}`);
  }

  // Build hash with destination path and query params
  const queryString = parts.length > 0 ? `?${parts.join("&")}` : "";
  window.location.hash = DESTINATION_PATH + queryString;
}

// Update results whenever state changes
function updateResults() {
  renderResults();
  updateDirectionsLink();
}

// Get mode display name
function getModeLabel(mode) {
  return appData?.modeLabels[mode] || mode;
}

// Get cost label based on mode
function getCostLabel(mode) {
  return appData?.costLabels[mode] || "Willing to pay";
}

// Update preferences visibility based on mode
function updateDirectionsLink() {
  const directionsLink = document.getElementById("directionsLink");
  const directionsLinkText = document.getElementById("directionsLinkText");
  if (!directionsLink || !directionsLinkText) return;

  const destination = encodeURIComponent(
    state.destination + ", Grand Rapids, MI",
  );
  let linkUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
  let linkText = "Get directions on Google Maps";

  // Update link based on primary mode
  const primaryMode = state.modes.length > 0 ? state.modes[0] : "drive";
  switch (primaryMode) {
    case "drive":
      // Link to parking near destination
      linkUrl = `https://www.google.com/maps/search/?api=1&query=parking+near+${destination}`;
      linkText = "Find parking near destination";
      break;
    case "transit":
      // Link to transit stops near destination
      linkUrl = `https://www.google.com/maps/search/?api=1&query=transit+stop+near+${destination}`;
      linkText = "Find transit stop near destination";
      break;
    case "micromobility":
      // Link to destination (Lime scooters can be found via app)
      linkText = "Get directions to destination";
      break;
    case "rideshare":
      // Link to destination (rideshare drop-off)
      linkText = "Get directions to destination";
      break;
    case "shuttle":
      // Link to DASH stops near destination
      linkUrl = `https://www.google.com/maps/search/?api=1&query=DASH+shuttle+stop+near+${destination}`;
      linkText = "Find DASH stop near destination";
      break;
    case "bike":
      // Link to bike racks near destination
      linkUrl = `https://www.google.com/maps/search/?api=1&query=bike+rack+near+${destination}`;
      linkText = "Find bike rack near destination";
      break;
    default:
      linkText = "Get directions on Google Maps";
  }

  directionsLink.href = linkUrl;
  directionsLinkText.textContent = linkText;
}

// Update reset modes button visibility based on whether preferences are selected
function updateResetModesButtonVisibility() {
  const resetModesBtn = document.getElementById("resetModesButton");
  if (!resetModesBtn) return;

  // Show button if modes are selected, or walk/cost have been changed
  const hasPreferences =
    (state.modes && state.modes.length > 0) || walkChanged || costChanged;

  if (hasPreferences) {
    resetModesBtn.classList.remove("hidden");
  } else {
    resetModesBtn.classList.add("hidden");
  }
}

function updatePreferencesVisibility() {
  const walkSlider = document.getElementById("walkSlider");
  const costSlider = document.getElementById("costSlider");
  const walkValue = document.getElementById("walkValue");
  const walkUnit = document.getElementById("walkUnit");
  const costValue = document.getElementById("costValue");
  const costPrefix = document.getElementById("costPrefix");
  const costLabel = document.getElementById("costLabel");

  // Walk slider: disabled only if rideshare is the ONLY mode (everyone can walk a little)
  // If other modes are selected that need walking distance, keep it enabled
  const walkDisabled =
    state.modes.length === 1 && state.modes.includes("rideshare");
  const walkTime = document.getElementById("walkTime");
  const walkTimeValue = document.getElementById("walkTimeValue");
  walkSlider.disabled = walkDisabled;
  if (walkDisabled) {
    walkValue.textContent = "—";
    walkUnit.textContent = "";
    if (walkTime) walkTime.style.display = "none";
  } else {
    walkValue.textContent = state.walkMiles.toFixed(1);
    walkUnit.textContent = " miles";
    // Calculate walking time (assuming 3 mph average walking speed)
    const walkMinutes = Math.round(state.walkMiles * 20); // 3 mph = 20 min per mile
    if (walkTimeValue) walkTimeValue.textContent = walkMinutes;
    if (walkTime) walkTime.style.display = "inline";
  }

  // Cost slider: disabled for bike mode (biking is free) or if shuttle is the only mode (DASH is free)
  const costDisabled =
    state.modes.includes("bike") ||
    (state.modes.length === 1 && state.modes.includes("shuttle"));
  costSlider.disabled = costDisabled;
  if (costDisabled) {
    costValue.textContent = "—";
    costPrefix.textContent = "";
  } else {
    // For transit and micromobility, show total cost (per-person * people), otherwise show per-person cost
    const displayCost =
      state.modes.includes("transit") || state.modes.includes("micromobility")
        ? state.costDollars * state.people
        : state.costDollars;
    // Show as whole dollar amount
    costValue.textContent = Math.round(displayCost);
    costPrefix.textContent = "$";
  }

  // Update cost label based on primary mode
  const primaryMode = state.modes.length > 0 ? state.modes[0] : "drive";
  costLabel.textContent = getCostLabel(primaryMode);

  // Gray out entire section if all preferences are disabled
  const allDisabled = walkDisabled && costDisabled;
  const preferencesSection = document.getElementById("preferencesSection");
  const preferencesHeading = document.getElementById("preferencesHeading");
  if (preferencesSection) {
    preferencesSection.classList.toggle("opacity-50", allDisabled);
  }
  if (preferencesHeading) {
    preferencesHeading.classList.toggle("opacity-50", allDisabled);
  }
}

// Toggle mode selection (multi-select)
function toggleMode(mode) {
  if (!validModes.includes(mode)) return;
  if (!checkRequiredFields()) return; // Don't allow mode selection if required fields aren't set

  const index = state.modes.indexOf(mode);
  if (index > -1) {
    // Remove mode if already selected
    state.modes.splice(index, 1);
  } else {
    // Add mode if not selected
    state.modes.push(mode);
  }

  highlightMode();
  updatePreferencesVisibility();
  updateResetModesButtonVisibility();
  updateResults();
  updateFragment();
}

// Handle browser back/forward navigation
window.addEventListener("hashchange", () => {
  const params = parseFragment();
  if (params.modes !== undefined) {
    const modesArray = params.modes
      ? params.modes.split(",").filter((m) => validModes.includes(m))
      : [];
    state.modes = modesArray;
    highlightMode();
    updatePreferencesVisibility();
  }
  if (params.day !== undefined && params.day !== state.day) {
    state.day = params.day || "";
    daySelect.value = state.day;
    // Update placeholder styling
    if (state.day) {
      daySelect.classList.remove("placeholder");
    } else {
      daySelect.classList.add("placeholder");
    }
    dayChanged = true;
  }
  if (params.time !== undefined && params.time !== state.time) {
    state.time = params.time || "";
    timeSelect.value = state.time;
    // Update placeholder styling
    if (state.time) {
      timeSelect.classList.remove("placeholder");
    } else {
      timeSelect.classList.add("placeholder");
    }
    timeChanged = true;
  }
  if (params.people !== undefined && params.people !== state.people) {
    const peopleValue = Number(params.people);
    // Clamp to valid range (1-6)
    const clampedValue = Math.max(1, Math.min(6, peopleValue));
    if (clampedValue >= 1 && clampedValue <= 6) {
      state.people = clampedValue;
      document.getElementById("peopleCount").textContent = state.people;
      peopleChanged = true;
    }
  }
  updateResults();
  // Don't update fragment here to avoid loop
});

function highlightMode() {
  document.querySelectorAll(".modeBtn").forEach((btn) => {
    const active = state.modes.includes(btn.dataset.mode);
    btn.classList.toggle("bg-slate-900", active);
    btn.classList.toggle("text-white", active);
    btn.classList.toggle("border-slate-900", active);
    // Update hover state based on active state (only if not disabled)
    if (!btn.disabled) {
      if (active) {
        btn.classList.remove("hover:bg-slate-100");
        btn.classList.add("hover:bg-slate-800");
      } else {
        btn.classList.remove("hover:bg-slate-800");
        btn.classList.add("hover:bg-slate-100");
      }
    }
  });
}

function adjustPeople(delta) {
  state.people = Math.max(1, Math.min(6, state.people + delta));
  document.getElementById("peopleCount").textContent = state.people;
  peopleChanged = true;
  // Always update preferences visibility to refresh cost display (shows total for transit/micromobility)
  updatePreferencesVisibility();
  updateFragment();
  updateResults();
}

// Sliders
const walkSlider = document.getElementById("walkSlider");
const costSlider = document.getElementById("costSlider");

walkSlider.addEventListener("input", (e) => {
  state.walkMiles = Number(e.target.value);
  walkChanged = true;
  const walkValue = document.getElementById("walkValue");
  const walkUnit = document.getElementById("walkUnit");
  const walkTime = document.getElementById("walkTime");
  const walkTimeValue = document.getElementById("walkTimeValue");
  if (!walkSlider.disabled) {
    walkValue.textContent = state.walkMiles.toFixed(1);
    walkUnit.textContent = " miles";
    // Calculate walking time (assuming 3 mph average walking speed)
    const walkMinutes = Math.round(state.walkMiles * 20); // 3 mph = 20 min per mile
    if (walkTimeValue) walkTimeValue.textContent = walkMinutes;
    if (walkTime) walkTime.style.display = "inline";
  }
  updateResetModesButtonVisibility();
  updateFragment();
  updateResults();
});

costSlider.addEventListener("input", (e) => {
  state.costDollars = Number(e.target.value);
  costChanged = true;
  const costValue = document.getElementById("costValue");
  const costPrefix = document.getElementById("costPrefix");
  if (!costSlider.disabled) {
    // For transit and micromobility, show total cost (per-person * people), otherwise show per-person cost
    const displayCost =
      state.modes.includes("transit") || state.modes.includes("micromobility")
        ? state.costDollars * state.people
        : state.costDollars;
    // Show as whole dollar amount
    costValue.textContent = Math.round(displayCost);
    costPrefix.textContent = "$";
  }
  updateResetModesButtonVisibility();
  updateFragment();
  updateResults();
});

// Day and Time inputs
const daySelect = document.getElementById("daySelect");
const timeSelect = document.getElementById("timeSelect");
const earlySlider = document.getElementById("earlySlider");
const lateSlider = document.getElementById("lateSlider");

// Check if all required fields are set (destination, day, time)
function checkRequiredFields() {
  const hasDestination = state.destination && state.destination.trim() !== "";
  const hasDay = state.day && state.day.trim() !== "";
  const hasTime = state.time && state.time.trim() !== "";
  return hasDestination && hasDay && hasTime;
}

// Enable/disable modes section based on required fields
function updateModesSectionState() {
  const preferencesSection = document.getElementById("preferencesSection");
  const modeButtons = document.querySelectorAll(".modeBtn");
  const isEnabled = checkRequiredFields();

  if (preferencesSection) {
    if (isEnabled) {
      preferencesSection.classList.remove("disabled");
    } else {
      preferencesSection.classList.add("disabled");
    }
  }

  // Disable/enable mode buttons
  modeButtons.forEach((btn) => {
    btn.disabled = !isEnabled;
    if (!isEnabled) {
      btn.classList.add("opacity-50", "cursor-not-allowed");
      btn.classList.remove("hover:bg-slate-100", "hover:bg-slate-800");
    } else {
      btn.classList.remove("opacity-50", "cursor-not-allowed");
      // Add appropriate hover state based on active state
      const isActive = state.modes.includes(btn.dataset.mode);
      if (isActive) {
        btn.classList.remove("hover:bg-slate-100");
        btn.classList.add("hover:bg-slate-800");
      } else {
        btn.classList.remove("hover:bg-slate-800");
        btn.classList.add("hover:bg-slate-100");
      }
    }
  });

  // Disable sliders when modes section is disabled
  if (walkSlider) {
    if (!isEnabled) {
      walkSlider.disabled = true;
    } else {
      // Re-enable if not disabled by other logic (e.g., rideshare mode)
      // updatePreferencesVisibility will handle the actual state
      updatePreferencesVisibility();
    }
  }
  if (costSlider) {
    if (!isEnabled) {
      costSlider.disabled = true;
    } else {
      // Re-enable if not disabled by other logic (e.g., bike mode)
      // updatePreferencesVisibility will handle the actual state
      updatePreferencesVisibility();
    }
  }
}

// Update reset button visibility based on required fields
function updateMinimizeButtonState() {
  const resetBtn = document.getElementById("resetButton");
  // Only update if the card is not collapsed (minimized view is hidden)
  if (whereWhenMinimized && whereWhenMinimized.classList.contains("hidden")) {
    // Reset button can be shown independently in top right if there's anything to clear
    // Show when day or time is changed
    if (resetBtn) {
      if (dayChanged || timeChanged) {
        resetBtn.classList.remove("hidden");
      } else {
        resetBtn.classList.add("hidden");
      }
    }
  }
}

if (daySelect) {
  daySelect.addEventListener("change", (e) => {
    if (!state) return; // Don't process if state isn't initialized yet
    state.day = e.target.value;
    dayChanged = true;
    // Update placeholder styling
    if (state.day) {
      daySelect.classList.remove("placeholder");
    } else {
      daySelect.classList.add("placeholder");
    }
    updateModesSectionState();
    updateMinimizeButtonState(); // Update minimize button state
    updateMinimizedView(); // Update minimized view if visible
    updateSaveButtonState();
    updateFragment();
    updateResults();
  });
}

if (timeSelect) {
  timeSelect.addEventListener("change", (e) => {
    if (!state) return; // Don't process if state isn't initialized yet
    state.time = e.target.value;
    timeChanged = true;
    // Update placeholder styling
    if (state.time) {
      timeSelect.classList.remove("placeholder");
    } else {
      timeSelect.classList.add("placeholder");
    }
    updateModesSectionState();
    updateMinimizeButtonState(); // Update minimize button state
    updateMinimizedView(); // Update minimized view if visible
    updateSaveButtonState();
    // Always add time to fragment when user selects it
    updateFragment();
    updateResults();
  });
}

// Update save button state based on required fields
function updateSaveButtonState() {
  const saveButton = document.getElementById("saveButton");
  if (!saveButton) return;

  const allFieldsFilled = checkRequiredFields();
  saveButton.disabled = !allFieldsFilled;
}

// Save button click handler
const saveButton = document.getElementById("saveButton");
if (saveButton) {
  saveButton.addEventListener("click", () => {
    if (!checkRequiredFields()) return;

    // Update fragment and results
    updateFragment();
    updateResults();

    // Collapse the card after saving
    minimizeWhereWhen();
  });
}

// Where/When toggle (minimize button)
const whereWhenContent = document.getElementById("whereWhenContent");
const whereWhenMinimized = document.getElementById("whereWhenMinimized");
const whereWhenExpand = document.getElementById("whereWhenExpand");

function updateMinimizedView() {
  const minimizedDestination = document.getElementById("minimizedDestination");
  const minimizedDay = document.getElementById("minimizedDay");
  const minimizedTime = document.getElementById("minimizedTime");

  if (minimizedDestination && state) {
    minimizedDestination.textContent = state.destination || "Van Andel Arena";
  }

  if (minimizedDay && state) {
    // Format day display
    const dayLabels = {
      monday: "Monday",
      tuesday: "Tuesday",
      wednesday: "Wednesday",
      thursday: "Thursday",
      friday: "Friday",
      saturday: "Saturday",
      sunday: "Sunday",
    };
    minimizedDay.textContent = dayLabels[state.day] || state.day || "";
  }

  const minimizedTimeSeparator = document.getElementById(
    "minimizedTimeSeparator",
  );
  if (minimizedTime && state) {
    if (state.time) {
      // Format time display (convert 24-hour to 12-hour)
      const [hours, minutes] = state.time.split(":");
      const hour24 = parseInt(hours, 10);
      const hour12 = hour24 > 12 ? hour24 - 12 : hour24 === 0 ? 12 : hour24;
      const ampm = hour24 >= 12 ? "PM" : "AM";
      minimizedTime.textContent = `${hour12}:${minutes} ${ampm}`;
      // Show separator when time is present
      if (minimizedTimeSeparator) {
        minimizedTimeSeparator.classList.remove("hidden");
      }
    } else {
      minimizedTime.textContent = "";
      // Hide separator when time is not present
      if (minimizedTimeSeparator) {
        minimizedTimeSeparator.classList.add("hidden");
      }
    }
  }
}

function minimizeWhereWhen() {
  // Only allow collapsing if all required fields are filled
  if (!checkRequiredFields()) {
    return;
  }
  updateMinimizedView();
  whereWhenContent.classList.add("hidden");
  whereWhenMinimized.classList.remove("hidden");
  // Hide reset button when card is collapsed
  const resetBtn = document.getElementById("resetButton");
  if (resetBtn) {
    resetBtn.classList.add("hidden");
  }
}

function expandWhereWhen() {
  whereWhenContent.classList.remove("hidden");
  whereWhenMinimized.classList.add("hidden");
  // Update reset button visibility when expanded
  updateMinimizeButtonState();
}

whereWhenExpand.addEventListener("click", expandWhereWhen);

// Flexibility toggle
const flexibilityToggle = document.getElementById("flexibilityToggle");
const flexibilityContent = document.getElementById("flexibilityContent");
const flexibilityArrow = document.getElementById("flexibilityArrow");

flexibilityToggle.addEventListener("click", () => {
  const isHidden = flexibilityContent.classList.toggle("hidden");
  flexibilityArrow.textContent = isHidden ? "▼" : "▲";
  // Change text color: gray when collapsed, black when expanded
  if (isHidden) {
    flexibilityToggle.classList.remove("text-slate-900");
    flexibilityToggle.classList.add("text-slate-500");
  } else {
    flexibilityToggle.classList.remove("text-slate-500");
    flexibilityToggle.classList.add("text-slate-900");
  }
});

// People toggle
const peopleToggle = document.getElementById("peopleToggle");
const peopleContent = document.getElementById("peopleContent");
const peopleArrow = document.getElementById("peopleArrow");

peopleToggle.addEventListener("click", () => {
  const isHidden = peopleContent.classList.toggle("hidden");
  peopleArrow.textContent = isHidden ? "▼" : "▲";
  // Change text color: gray when collapsed, black when expanded
  if (isHidden) {
    peopleToggle.classList.remove("text-slate-900");
    peopleToggle.classList.add("text-slate-500");
  } else {
    peopleToggle.classList.remove("text-slate-500");
    peopleToggle.classList.add("text-slate-900");
  }
});

earlySlider.addEventListener("input", (e) => {
  state.flexibilityEarlyMins = Number(e.target.value);
  document.getElementById("earlyValue").textContent =
    `-${state.flexibilityEarlyMins}`;
  updateResults();
});

lateSlider.addEventListener("input", (e) => {
  state.flexibilityLateMins = Number(e.target.value);
  document.getElementById("lateValue").textContent =
    `+${state.flexibilityLateMins}`;
  updateResults();
});

function renderResults() {
  const resultsEl = document.getElementById("results");
  resultsEl.innerHTML = "";

  const { primary, alternate } = buildRecommendation();

  if (!primary) return;

  // Render primary recommendation (green, yellow if discouraged, or red if no options)
  const card = document.createElement("div");
  const isNoOptions = primary.isNoOptions;
  const isDiscouraged = primary.isDiscouraged;
  const cardId = `card-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  card.className = isNoOptions
    ? "rounded-none bg-red-50 border border-red-200 p-3 relative"
    : isDiscouraged
      ? "rounded-none bg-yellow-50 border border-yellow-200 p-3 relative"
      : "rounded-none bg-green-50 border border-green-200 p-3 relative";

  const recommendation = primary;

  // If there are steps, make them the primary focus
  if (isNoOptions) {
    card.innerHTML = `
      <div class="space-y-2">
        <div>
          <div class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Unknown Strategy</div>
          <h3 class="font-semibold text-base">${recommendation.title}</h3>
          <p class="text-sm text-slate-600 mt-1">${
            recommendation.body || recommendation.title
          }</p>
        </div>
      </div>
    `;
  } else if (recommendation.steps && recommendation.steps.length > 0) {
    const strategyLabel = isDiscouraged
      ? "Alternative Strategy"
      : "Recommended Strategy";
    const stepsId = `steps-${cardId}`;
    const toggleId = `toggle-${cardId}`;
    card.innerHTML = `
      <div class="space-y-2">
        <div>
          <div class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">${strategyLabel}</div>
          <div class="pr-24">
            <h3 class="font-semibold text-base">${recommendation.title}</h3>
          </div>
          <button type="button" id="${toggleId}" class="absolute top-3 right-3 text-xs px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-400 font-medium transition-colors" aria-label="Toggle steps">
            Show steps <span class="inline-block ml-1">▼</span>
          </button>
          <p class="text-sm text-slate-600 mt-1">${
            recommendation.body || recommendation.title
          }</p>
        </div>
        <div id="${stepsId}" class="hidden space-y-2 mt-2">
          <ol class="space-y-2">
            ${recommendation.steps
              .map(
                (step, index) => `
              <li class="flex gap-2">
                <span class="flex-shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">${
                  index + 1
                }</span>
                <div class="flex-1 pt-0.5">
                  <div class="font-semibold text-sm text-slate-900">${
                    step.title
                  }</div>
                  ${
                    step.description
                      ? `<div class="text-sm text-slate-600 mt-1 leading-relaxed">${step.description}</div>`
                      : ""
                  }
                  ${
                    step.link
                      ? `<a href="${
                          step.link
                        }" target="_blank" rel="noopener noreferrer" class="mt-1 inline-block text-sm text-blue-600 hover:text-blue-800 underline">${
                          step.linkText || "Open link"
                        } →</a>`
                      : ""
                  }
                </div>
              </li>
            `,
              )
              .join("")}
          </ol>
        </div>
      </div>
    `;

    // Add toggle functionality
    const toggleBtn = card.querySelector(`#${toggleId}`);
    const stepsDiv = card.querySelector(`#${stepsId}`);
    if (toggleBtn && stepsDiv) {
      toggleBtn.addEventListener("click", () => {
        const isHidden = stepsDiv.classList.toggle("hidden");
        const arrow = toggleBtn.querySelector("span span");
        if (arrow) {
          arrow.textContent = isHidden ? "▼" : "▲";
        }
        toggleBtn.innerHTML = isHidden
          ? 'Show steps <span class="inline-block ml-1">▼</span>'
          : 'Hide steps <span class="inline-block ml-1">▲</span>';
      });
    }
  } else {
    // Single step instruction format
    const strategyLabel = isDiscouraged
      ? "Alternative Strategy"
      : "Recommended Strategy";
    card.innerHTML = `
      <div class="space-y-2">
        <div>
          <div class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">${strategyLabel}</div>
          <h3 class="font-semibold text-base">${recommendation.title}</h3>
        </div>
        <div class="space-y-2">
          <div class="flex gap-2">
            <span class="flex-shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">1</span>
            <div class="flex-1 pt-0.5">
              <div class="font-semibold text-sm text-slate-900">${
                recommendation.instruction || recommendation.title
              }</div>
              <div class="text-sm text-slate-600 mt-1 leading-relaxed">${
                recommendation.body || recommendation.title
              }</div>
            </div>
          </div>
        </div>
        ${
          recommendation.meta
            ? `<div class="pt-2 border-t border-slate-200 text-sm text-slate-500">${recommendation.meta}</div>`
            : ""
        }
      </div>
    `;
  }

  resultsEl.appendChild(card);

  // Render alternate recommendation (yellow) if applicable
  if (alternate) {
    const altCard = document.createElement("div");
    const altCardId = `alt-card-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    altCard.className =
      "rounded-none bg-yellow-50 border border-yellow-200 p-3 mt-2 relative";

    if (alternate.steps && alternate.steps.length > 0) {
      const altStepsId = `steps-${altCardId}`;
      const altToggleId = `toggle-${altCardId}`;
      altCard.innerHTML = `
        <div class="space-y-2">
          <div>
            <div class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Alternate Strategy</div>
            <div class="pr-24">
              <h3 class="font-semibold text-base">${alternate.title}</h3>
            </div>
            <button type="button" id="${altToggleId}" class="absolute top-3 right-3 text-xs px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-400 font-medium transition-colors" aria-label="Toggle steps">
              Show steps <span class="inline-block ml-1">▼</span>
            </button>
            <p class="text-sm text-slate-600 mt-1">${
              alternate.body || alternate.title
            }</p>
          </div>
          <div id="${altStepsId}" class="hidden space-y-2 mt-2">
            <ol class="space-y-2">
              ${alternate.steps
                .map(
                  (step, index) => `
                <li class="flex gap-2">
                  <span class="flex-shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">${
                    index + 1
                  }</span>
                  <div class="flex-1 pt-0.5">
                    <div class="font-semibold text-sm text-slate-900">${
                      step.title
                    }</div>
                    ${
                      step.description
                        ? `<div class="text-sm text-slate-600 mt-1 leading-relaxed">${step.description}</div>`
                        : ""
                    }
                    ${
                      step.link
                        ? `<a href="${
                            step.link
                          }" target="_blank" rel="noopener noreferrer" class="mt-1 inline-block text-sm text-blue-600 hover:text-blue-800 underline">${
                            step.linkText || "Open link"
                          } →</a>`
                        : ""
                    }
                  </div>
                </li>
              `,
                )
                .join("")}
            </ol>
          </div>
        </div>
      `;

      // Add toggle functionality for alternate card
      const altToggleBtn = altCard.querySelector(`#${altToggleId}`);
      const altStepsDiv = altCard.querySelector(`#${altStepsId}`);
      if (altToggleBtn && altStepsDiv) {
        altToggleBtn.addEventListener("click", () => {
          const isHidden = altStepsDiv.classList.toggle("hidden");
          const arrow = altToggleBtn.querySelector("span span");
          if (arrow) {
            arrow.textContent = isHidden ? "▼" : "▲";
          }
          altToggleBtn.innerHTML = isHidden
            ? 'Show steps <span class="inline-block ml-1">▼</span>'
            : 'Hide steps <span class="inline-block ml-1">▲</span>';
        });
      }
    } else {
      altCard.innerHTML = `
        <div class="space-y-2">
          <div>
            <div class="text-sm font-medium text-slate-500 uppercase tracking-wide mb-1">Alternate Strategy</div>
            <h3 class="font-semibold text-base">${alternate.title}</h3>
          </div>
          <div class="space-y-2">
            <div class="flex gap-2">
              <span class="flex-shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">1</span>
              <div class="flex-1 pt-0.5">
                <div class="font-semibold text-sm text-slate-900">${
                  alternate.instruction || alternate.title
                }</div>
                <div class="text-sm text-slate-600 mt-1 leading-relaxed">${
                  alternate.body || alternate.title
                }</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    resultsEl.appendChild(altCard);
  }
}

// Check if parking meters are enforced based on day and time
// Grand Rapids parking meters are enforced Monday-Friday 8am-7pm
// Free after 7pm on weekdays and all day on weekends
function isParkingEnforced(day, time) {
  if (!day || !time) return true; // Default to enforced if day/time not set

  // Parse time (HH:MM format)
  const [hours, minutes] = time.split(":").map(Number);
  const hour24 = hours;

  // Check if it's a weekend
  const weekendDays = ["saturday", "sunday"];
  if (weekendDays.includes(day.toLowerCase())) {
    return false; // No enforcement on weekends
  }

  // Check if it's a weekday
  const weekdayDays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  if (weekdayDays.includes(day.toLowerCase())) {
    // Enforcement is 8am-7pm on weekdays
    // If time is before 8am or at/after 7pm, no enforcement
    if (hour24 < 8 || hour24 >= 19) {
      return false;
    }
    return true;
  }

  // If day is not recognized, default to enforced
  return true;
}

// Calculate the minimum cost required for metered parking based on arrival time and enforcement
// Returns the minimum cost needed, or 0 if parking is not enforced
function calculateRequiredMeteredParkingCost(day, time) {
  if (!day || !time) return 0;

  const parkingEnforced = isParkingEnforced(day, time);
  if (!parkingEnforced) {
    return 0; // No cost if parking is not enforced
  }

  // Parse time (HH:MM format)
  const [hours, minutes] = time.split(":").map(Number);
  const hour24 = hours;
  const minute24 = minutes;

  // Check if it's a weekday
  const weekdayDays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  if (weekdayDays.includes(day.toLowerCase())) {
    // Enforcement ends at 7pm (19:00)
    const enforcementEndHour = 19;
    const enforcementEndMinute = 0;

    // Calculate hours and minutes until enforcement ends
    let hoursUntilEnd = enforcementEndHour - hour24;
    let minutesUntilEnd = enforcementEndMinute - minute24;

    // Handle minute overflow
    if (minutesUntilEnd < 0) {
      minutesUntilEnd += 60;
      hoursUntilEnd -= 1;
    }

    // Calculate total minutes until enforcement ends
    const totalMinutesUntilEnd = hoursUntilEnd * 60 + minutesUntilEnd;

    // If already past enforcement end, no cost
    if (totalMinutesUntilEnd <= 0) {
      return 0;
    }

    // Metered parking costs $1.25-$2.00 per half hour in prime areas
    // Use the higher rate ($2.00 per half hour = $4.00 per hour) to ensure budget is sufficient
    const hourlyRate = 4.0; // $4.00 per hour (worst case)
    const halfHourRate = 2.0; // $2.00 per half hour

    // Calculate cost: round up to nearest half hour
    const halfHoursNeeded = Math.ceil(totalMinutesUntilEnd / 30);
    const requiredCost = halfHoursNeeded * halfHourRate;

    return requiredCost;
  }

  return 0;
}

// Helper function to replace placeholders in text
function replacePlaceholders(text, values) {
  let result = text;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}

// Helper function to process recommendation data and replace placeholders
function processRecommendationData(recData, values) {
  if (!recData) return null;

  const processed = { ...recData };

  // Replace placeholders in title and body
  if (processed.title) {
    processed.title = replacePlaceholders(processed.title, values);
  }
  if (processed.body) {
    processed.body = replacePlaceholders(processed.body, values);
  }

  // Process steps
  if (processed.steps) {
    processed.steps = processed.steps.map((step) => {
      const processedStep = { ...step };
      if (processedStep.title) {
        processedStep.title = replacePlaceholders(processedStep.title, values);
      }
      if (processedStep.description) {
        processedStep.description = replacePlaceholders(
          processedStep.description,
          values,
        );
      }
      if (processedStep.linkTemplate) {
        processedStep.link = replacePlaceholders(
          processedStep.linkTemplate,
          values,
        );
        delete processedStep.linkTemplate;
      }
      return processedStep;
    });
  }

  // Process alternate
  if (processed.alternate) {
    processed.alternate = processRecommendationData(
      processed.alternate,
      values,
    );
  }

  return processed;
}

function buildRecommendation() {
  const { modes, people, walkMiles, costDollars } = state;

  if (!modes || modes.length === 0) return { primary: null, alternate: null };

  let steps = [];
  let recommendation = {};
  let alternate = null;

  // Prepare placeholder values
  const placeholders = {
    walkMiles: walkMiles.toFixed(1),
    destination: state.destination,
    destinationEncoded: encodeURIComponent(
      state.destination + ", Grand Rapids, MI",
    ),
  };

  // Check which modes are selected
  const hasDrive = modes.includes("drive");
  const hasTransit = modes.includes("transit");
  const hasRideshare = modes.includes("rideshare");
  const hasMicromobility = modes.includes("micromobility");
  const hasShuttle = modes.includes("shuttle");
  const hasBike = modes.includes("bike");

  // Build recommendation based on selected modes
  // Priority: drive combinations > rideshare > drive-only > transit combinations > single modes

  if (hasDrive && (hasShuttle || hasTransit || hasMicromobility)) {
    // Drive mode combinations (these take priority)
    if (hasShuttle) {
      // Drive + Shuttle: Park farther, use DASH
      const recKey = walkMiles === 0 ? "noWalk" : "default";
      const recData = appData.recommendations["drive+shuttle"][recKey];
      recommendation = processRecommendationData(recData, placeholders);
      if (recommendation.steps) {
        steps.push(...recommendation.steps);
      }
      // If this combination doesn't work, fall back to other modes
      if (recommendation.isNoOptions && hasRideshare && costDollars >= 10) {
        // Fall back to rideshare if available and budget is sufficient
        const rideshareRecKey = costDollars < 10 ? "noCost" : "default";
        const rideshareRecData =
          appData.recommendations.rideshare[rideshareRecKey];
        recommendation = processRecommendationData(
          rideshareRecData,
          placeholders,
        );
        steps = [];
        if (recommendation.steps) {
          steps.push(...recommendation.steps);
        }
      }
    } else if (hasTransit) {
      // Drive + Transit: Park at Rapid stop, take transit
      const recKey = walkMiles === 0 ? "noWalk" : "default";
      const recData = appData.recommendations["drive+transit"][recKey];
      recommendation = processRecommendationData(recData, placeholders);
      if (recommendation.steps) {
        steps.push(...recommendation.steps);
      }
      // If this combination doesn't work, fall back to other modes
      if (recommendation.isNoOptions) {
        if (hasRideshare && costDollars >= 10) {
          // Fall back to rideshare if available and budget is sufficient
          const rideshareRecKey = costDollars < 10 ? "noCost" : "default";
          const rideshareRecData =
            appData.recommendations.rideshare[rideshareRecKey];
          recommendation = processRecommendationData(
            rideshareRecData,
            placeholders,
          );
          steps = [];
          if (recommendation.steps) {
            steps.push(...recommendation.steps);
          }
        } else if (hasTransit && costDollars >= 2 && walkMiles > 0) {
          // Fall back to transit-only if available
          const transitRecKey =
            costDollars < 2 ? "noCost" : walkMiles === 0 ? "noWalk" : "default";
          const transitRecData = appData.recommendations.transit[transitRecKey];
          recommendation = processRecommendationData(
            transitRecData,
            placeholders,
          );
          steps = [];
          if (recommendation.steps) {
            steps.push(...recommendation.steps);
          }
        }
      }
    } else if (hasMicromobility) {
      // Drive + Micromobility: Park farther, use Lime
      const recKey = walkMiles === 0 ? "noWalk" : "default";
      const recData = appData.recommendations["drive+micromobility"][recKey];
      recommendation = processRecommendationData(recData, placeholders);
      if (recommendation.steps) {
        steps.push(...recommendation.steps);
      }
      // If this combination doesn't work, fall back to other modes
      if (recommendation.isNoOptions && hasRideshare && costDollars >= 10) {
        // Fall back to rideshare if available and budget is sufficient
        const rideshareRecKey = costDollars < 10 ? "noCost" : "default";
        const rideshareRecData =
          appData.recommendations.rideshare[rideshareRecKey];
        recommendation = processRecommendationData(
          rideshareRecData,
          placeholders,
        );
        steps = [];
        if (recommendation.steps) {
          steps.push(...recommendation.steps);
        }
      }
    }
  } else if (hasRideshare) {
    // Rideshare mode - prioritize over drive-only when both are selected
    // Rideshare mode - requires at least $10
    const recKey = costDollars < 10 ? "noCost" : "default";
    const recData = appData.recommendations.rideshare[recKey];
    recommendation = processRecommendationData(recData, placeholders);
    if (recommendation.steps) {
      steps.push(...recommendation.steps);
    }
  } else if (hasDrive) {
    // Drive only (only if rideshare is not selected)
    // Adjust effective cost based on parking enforcement
    const parkingEnforced = isParkingEnforced(state.day, state.time);
    // If parking is free (after 7pm on weekdays or weekends) and user has low budget (< $8),
    // treat as $0 to recommend free street parking
    // If user is willing to pay $8+, use their actual budget to recommend paid parking
    // Handle undefined costDollars (defaults to 0)
    const safeCostDollars = costDollars ?? 0;
    const effectiveCostDollars =
      !parkingEnforced && walkMiles > 0 && safeCostDollars < 8
        ? 0
        : safeCostDollars;

    // Calculate required metered parking cost if parking is enforced
    // There's no free street parking within 0.5 miles of Van Andel Arena during enforcement hours
    const requiredMeteredCost = calculateRequiredMeteredParkingCost(
      state.day,
      state.time,
    );
    const hasFreeParkingAvailable = !parkingEnforced || walkMiles > 0.5;

    let recKey;
    if (walkMiles === 0) {
      recKey = "noWalk";
    } else if (parkingEnforced && safeCostDollars === 0) {
      // If parking is enforced and user won't pay (cost is $0), no options available
      recKey = "noCost";
    } else if (
      parkingEnforced &&
      !hasFreeParkingAvailable &&
      requiredMeteredCost > 0 &&
      safeCostDollars < requiredMeteredCost
    ) {
      // If parking is enforced, no free parking available, and user's budget is less than required metered cost
      recKey = "noCost";
    } else if (walkMiles > 0 && effectiveCostDollars >= 20) {
      // If user is willing to pay $20+, recommend premium ramps (structured parking garages, $27-$30)
      // Premium ramps like Arena Place Garage are directly across from the arena
      recKey = "premiumRamp";
    } else if (walkMiles > 0 && effectiveCostDollars >= 12) {
      // If user is willing to pay $12-$19, recommend city parking garages ($1.50/hour, max $12)
      // City garages like Monroe Center Ramp and Ottawa-Fulton Ramp are affordable structured parking
      recKey = "cheaperGarage";
    } else if (
      walkMiles >= 0.5 &&
      effectiveCostDollars >= 8 &&
      effectiveCostDollars < 12
    ) {
      // If user is willing to pay $8-$11 and can walk at least 0.5 miles, recommend affordable surface lots ($8-$10 for 4 hours)
      // Surface lots are cheaper than garages but fill up quickly and are 0.2-0.5 miles from Van Andel Arena
      recKey = "affordableLot";
    } else if (
      walkMiles > 0 &&
      walkMiles < 0.5 &&
      effectiveCostDollars >= 8 &&
      effectiveCostDollars < 12
    ) {
      // If user is willing to pay $8-$11 but can't walk 0.5+ miles, recommend cheaper garage instead
      // Surface lots require at least 0.5 miles walking distance, but cheaper garages are closer (0.2-0.3 miles)
      recKey = "cheaperGarage";
    } else if (walkMiles > 0 && effectiveCostDollars >= 1) {
      // If user is willing to pay $1-$7, recommend metered street parking ($1.50/hour, 2-3 hour max)
      // Meters are the most affordable paid option but have time limits
      recKey = "meteredParking";
    } else if (effectiveCostDollars < 1) {
      // If user won't pay or parking is not enforced, recommend free street parking
      recKey = "freeStreet";
    } else {
      recKey = "premiumRamp";
    }

    const recData = appData.recommendations.drive[recKey];
    recommendation = processRecommendationData(recData, placeholders);
    if (recommendation.steps) {
      steps.push(...recommendation.steps);
    }
    if (recommendation.alternate) {
      // Don't show surface lot alternate if user can't walk 0.5+ miles
      // Surface lots require at least 0.5 miles walking distance
      if (
        recKey === "cheaperGarage" &&
        walkMiles < 0.5 &&
        recommendation.alternate.title &&
        recommendation.alternate.title.toLowerCase().includes("surface lot")
      ) {
        // Skip the alternate for surface lots when walk distance is insufficient
        alternate = null;
      } else {
        alternate = recommendation.alternate;
      }
    }
  } else if (hasTransit) {
    // Transit mode
    if (hasShuttle) {
      // Transit + Shuttle: Take Rapid, then DASH - requires at least $2
      let recKey;
      if (costDollars < 2) {
        recKey = "noCost";
      } else if (walkMiles === 0) {
        recKey = "noWalk";
      } else {
        recKey = "default";
      }
      const recData = appData.recommendations["transit+shuttle"][recKey];
      recommendation = processRecommendationData(recData, placeholders);
      if (recommendation.steps) {
        steps.push(...recommendation.steps);
      }
    } else {
      // Transit only - requires at least $2
      let recKey;
      if (costDollars < 2) {
        recKey = "noCost";
      } else if (walkMiles === 0) {
        recKey = "noWalk";
      } else {
        recKey = "default";
      }
      const recData = appData.recommendations.transit[recKey];
      recommendation = processRecommendationData(recData, placeholders);
      if (recommendation.steps) {
        steps.push(...recommendation.steps);
      }
    }
  } else if (hasMicromobility) {
    // Micromobility mode - requires at least $4
    const recKey = costDollars < 4 ? "noCost" : "default";
    const recData = appData.recommendations.micromobility[recKey];
    recommendation = processRecommendationData(recData, placeholders);
    if (recommendation.steps) {
      steps.push(...recommendation.steps);
    }
  } else if (hasShuttle) {
    // Shuttle mode (DASH)
    const recKey = walkMiles === 0 ? "noWalk" : "default";
    const recData = appData.recommendations.shuttle[recKey];
    recommendation = processRecommendationData(recData, placeholders);
    if (recommendation.steps) {
      steps.push(...recommendation.steps);
    }
  } else if (hasBike) {
    // Bike mode
    const recData = appData.recommendations.bike.default;
    recommendation = processRecommendationData(recData, placeholders);
    if (recommendation.steps) {
      steps.push(...recommendation.steps);
    }
  }

  recommendation.steps = steps;
  return { primary: recommendation, alternate: alternate };
}

// Initialize application
async function init() {
  // Migrate old hash format to new format with destination path
  const currentHash = window.location.hash.slice(1); // Remove the #
  if (currentHash && !currentHash.startsWith(DESTINATION_PATH)) {
    // If hash exists but doesn't start with destination path, migrate it
    // Preserve any existing params by converting to query string format
    if (currentHash.includes("=")) {
      // Old format: params directly in hash
      window.location.hash = DESTINATION_PATH + "?" + currentHash;
    } else {
      // No params, just set destination path
      window.location.hash = DESTINATION_PATH;
    }
  } else if (!currentHash) {
    // No hash at all, set destination path
    window.location.hash = DESTINATION_PATH;
  }

  // Load data first
  await loadData();

  // Initialize state from loaded data
  state = {
    destination: appData.destination,
    day: "", // Don't prefill day
    time: "", // Don't prefill time
    flexibilityEarlyMins: appData.defaults.flexibilityEarlyMins,
    flexibilityLateMins: appData.defaults.flexibilityLateMins,
    modes: [],
    people: appData.defaults.people,
    walkMiles: appData.defaults.walkMiles,
    parkingMins: appData.defaults.parkingMins,
    costDollars: appData.defaults.costDollars,
  };

  // Initialize validModes from loaded data
  validModes = appData.validModes;

  // Read from URL fragment
  const params = parseFragment();
  if (params.modes) {
    const modesArray = params.modes
      .split(",")
      .filter((m) => validModes.includes(m));
    if (modesArray.length > 0) {
      state.modes = modesArray;
    }
  }

  if (params.day) {
    state.day = params.day;
    dayChanged = true; // Mark as changed since it came from fragment
  }
  if (params.time) {
    state.time = params.time;
    timeChanged = true; // Mark as changed since it came from fragment
  }
  if (params.people) {
    const peopleValue = Number(params.people);
    // Clamp to valid range (1-6)
    const clampedValue = Math.max(1, Math.min(6, peopleValue));
    if (clampedValue >= 1 && clampedValue <= 6) {
      state.people = clampedValue;
      peopleChanged = true; // Mark as changed since it came from fragment
    }
  }
  if (params.walk) {
    const walkValue = Number(params.walk);
    if (!isNaN(walkValue) && walkValue >= 0) {
      state.walkMiles = walkValue;
      walkChanged = true; // Mark as changed since it came from fragment
      walkSlider.value = walkValue;
      updatePreferencesVisibility(); // Update UI
    }
  }
  if (params.pay !== undefined) {
    const payValue = Number(params.pay);
    if (!isNaN(payValue) && payValue >= 0) {
      state.costDollars = payValue;
      costChanged = true; // Mark as changed since it came from fragment
      updatePreferencesVisibility(); // Update UI
    }
  }

  // Generate time options and initialize inputs
  generateTimeOptions();
  daySelect.value = state.day || ""; // Clear day select if no day is set
  if (state.day) {
    daySelect.classList.remove("placeholder");
  } else {
    daySelect.classList.add("placeholder");
  }
  if (state.time) {
    timeSelect.value = state.time;
    timeSelect.classList.remove("placeholder");
  } else {
    timeSelect.value = ""; // Clear time select if no time is set
    timeSelect.classList.add("placeholder");
  }
  document.getElementById("peopleCount").textContent = state.people;

  // Update save button state
  updateSaveButtonState();

  // Collapse where/when card if all three required fields (destination, day, time) have values
  if (checkRequiredFields() && whereWhenContent && whereWhenMinimized) {
    minimizeWhereWhen();
  } else {
    // Update minimized view in case it's visible (shouldn't be, but just in case)
    updateMinimizedView();
  }

  // Initialize walk time estimate
  const walkTimeValue = document.getElementById("walkTimeValue");
  if (walkTimeValue) {
    const walkMinutes = Math.round(state.walkMiles * 20); // 3 mph = 20 min per mile
    walkTimeValue.textContent = walkMinutes;
  }

  // Set slider value AFTER all state initialization to avoid triggering input events
  costSlider.value = state.costDollars;
  earlySlider.value = state.flexibilityEarlyMins;
  lateSlider.value = state.flexibilityLateMins;
  document.getElementById("earlyValue").textContent =
    `-${state.flexibilityEarlyMins}`;
  document.getElementById("lateValue").textContent =
    `+${state.flexibilityLateMins}`;

  // Update Google Maps directions link
  updateDirectionsLink();

  // Expose state on window for testing (before rendering so tests can verify state)
  window.state = state;
  window.appData = appData;
  window.isParkingEnforced = isParkingEnforced;
  window.calculateRequiredMeteredParkingCost =
    calculateRequiredMeteredParkingCost;

  // Initialize UI
  updateModesSectionState();
  updateMinimizeButtonState(); // Set initial minimize button state
  highlightMode();
  updatePreferencesVisibility();
  updateResetModesButtonVisibility();
  renderResults();
}

// Reset function to clear all URL fragments and reset state
function resetAll() {
  // Reset state to defaults
  state.destination = appData.destination;
  state.day = ""; // Don't prefill day
  state.time = ""; // Don't prefill time
  state.flexibilityEarlyMins = appData.defaults.flexibilityEarlyMins;
  state.flexibilityLateMins = appData.defaults.flexibilityLateMins;
  state.modes = [];
  state.people = appData.defaults.people;
  state.walkMiles = appData.defaults.walkMiles;
  state.parkingMins = appData.defaults.parkingMins;
  state.costDollars = appData.defaults.costDollars;

  // Reset change flags
  dayChanged = false;
  timeChanged = false;
  peopleChanged = false;
  walkChanged = false;
  costChanged = false;

  // Clear URL fragment completely (but keep destination path)
  window.location.hash = DESTINATION_PATH;

  // Reset UI elements
  daySelect.value = state.day || ""; // Clear day select if no day is set
  if (state.day) {
    daySelect.classList.remove("placeholder");
  } else {
    daySelect.classList.add("placeholder");
  }
  if (state.time) {
    timeSelect.value = state.time;
    timeSelect.classList.remove("placeholder");
  } else {
    timeSelect.value = "";
    timeSelect.classList.add("placeholder");
  }
  document.getElementById("peopleCount").textContent = state.people;
  costSlider.value = state.costDollars;
  earlySlider.value = state.flexibilityEarlyMins;
  lateSlider.value = state.flexibilityLateMins;
  document.getElementById("earlyValue").textContent =
    `-${state.flexibilityEarlyMins}`;
  document.getElementById("lateValue").textContent =
    `+${state.flexibilityLateMins}`;

  // Reset walk slider
  walkSlider.value = state.walkMiles;
  const walkValue = document.getElementById("walkValue");
  const walkUnit = document.getElementById("walkUnit");
  const walkTime = document.getElementById("walkTime");
  const walkTimeValue = document.getElementById("walkTimeValue");
  if (walkValue) walkValue.textContent = state.walkMiles.toFixed(1);
  if (walkUnit) walkUnit.textContent = " miles";
  if (walkTimeValue) {
    const walkMinutes = Math.round(state.walkMiles * 20);
    walkTimeValue.textContent = walkMinutes;
  }
  if (walkTime) walkTime.style.display = "inline";

  // Reset cost display
  const costValue = document.getElementById("costValue");
  const costPrefix = document.getElementById("costPrefix");
  if (costValue) costValue.textContent = Math.round(state.costDollars);
  if (costPrefix) costPrefix.textContent = "$";

  // Update UI
  highlightMode();
  updatePreferencesVisibility();
  updateDirectionsLink();
  updateSaveButtonState();
  renderResults();
}

// Reset function to clear selected modes and preferences (walk/pay)
function resetModes() {
  // Remove modes, walk, and pay from URL fragment and reload
  const params = parseFragment();
  const newParts = [];

  // Keep only day, time, and people if they exist
  if (params.day) {
    newParts.push(`day=${encodeURIComponent(params.day)}`);
  }
  if (params.time) {
    newParts.push(`time=${timeToUrl(params.time)}`);
  }
  if (params.people) {
    newParts.push(`people=${encodeURIComponent(params.people)}`);
  }

  // Update URL without modes, walk, or pay
  const queryString = newParts.length > 0 ? `?${newParts.join("&")}` : "";
  window.location.hash = DESTINATION_PATH + queryString;

  // Reload the page to reset state
  window.location.reload();
}

// Attach reset button event listener
const resetButton = document.getElementById("resetButton");
if (resetButton) {
  resetButton.addEventListener("click", () => {
    // Navigate to the destination path without query params to clear all state
    window.location.hash = DESTINATION_PATH;
  });
}

// Attach reset modes button event listener
const resetModesButton = document.getElementById("resetModesButton");
if (resetModesButton) {
  resetModesButton.addEventListener("click", () => {
    resetModes();
  });
}

// Attach mode button event listeners
document.querySelectorAll(".modeBtn").forEach((btn) => {
  btn.addEventListener("click", function () {
    const mode = this.dataset.mode;
    if (mode) {
      toggleMode(mode);
    }
  });
});

// Start the application
init();
