"use strict";

const TIME_ZONE = "America/Los_Angeles";
const STARTED = Date.parse("2025-05-29T00:00:00-07:00");
const DAY = 86_400_000;
const REFERENCE_YEAR = 2025;
const MONTH_LOOKBACK = 6;
const TEMP_MEAN = "temperature_2m_mean";
const TEMP_MAX = "temperature_2m_max";
const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
const dayLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const localDate = new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "numeric", day: "numeric", timeZone: TIME_ZONE
});

const temperature = { unit: "°F", digits: 1, minStep: 10 };
const carbon = { unit: "ppm", digits: 2, minStep: 5 };
const seaLevel = { unit: "ft", digits: 2, minStep: 0.25, tickDigits: 2 };
const runButton = document.getElementById("runBtn");
const status = document.getElementById("status");
const results = document.getElementById("results");

function updateTimer() {
    const elapsed = Math.max(0, Date.now() - STARTED);
    const days = Math.floor(elapsed / DAY);
    const time = new Date(elapsed % DAY).toISOString().slice(11, 19);
    document.getElementById("timerBanner").textContent =
        `${days.toLocaleString("en-US")} days and ${time} since launch`;
}

function laCalendarDay(now) {
    const parts = Object.fromEntries(localDate.formatToParts(now).map(({ type, value }) => [type, value]));
    return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
}

function isoDay(date) {
    return date.toISOString().slice(0, 10);
}

function referenceYear(year) {
    return year > REFERENCE_YEAR ? REFERENCE_YEAR : year - 1;
}

async function request(url, type = "json") {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response[type]();
    if (payload.error) throw new Error("The data provider returned an error.");
    return payload;
}

function loadTemperature(start, end) {
    const params = new URLSearchParams({
        latitude: "32.8752631656",
        longitude: "-117.236132389",
        start_date: start,
        end_date: end,
        daily: `${TEMP_MEAN},${TEMP_MAX}`,
        models: "era5_land",
        timezone: TIME_ZONE,
        temperature_unit: "fahrenheit"
    });
    return request(`https://archive-api.open-meteo.com/v1/archive?${params}`);
}

function dailyValues(payload, field) {
    const dates = payload.daily?.time;
    const values = payload.daily?.[field];
    if (payload.daily_units?.[field] !== "°F" || !Array.isArray(dates) ||
        !Array.isArray(values) || dates.length !== values.length) {
        throw new Error("Invalid temperature series.");
    }
    const byDate = new Map(dates.map((date, index) => [date, values[index]]));
    if (byDate.size !== dates.length) throw new Error("Duplicate temperature dates.");
    return byDate;
}

function temperatureComparison(base, latest, field, pairs, summarize) {
    const baseValues = dailyValues(base, field);
    const latestValues = dailyValues(latest, field);
    const before = pairs.map(([date]) => baseValues.get(date));
    const after = pairs.map(([, date]) => latestValues.get(date));
    if (![...before, ...after].every(value => Number.isFinite(value) && value >= -40 && value <= 140)) {
        throw new Error("Incomplete or invalid matched temperature data.");
    }
    return [summarize(before), summarize(after)];
}

async function loadTemperatures(today) {
    // ERA5-Land normally runs five days behind. Leave a week for publication.
    let end = new Date(today.getTime() - 7 * DAY);
    if (isoDay(end).endsWith("02-29")) end = new Date(end.getTime() - DAY);
    const year = end.getUTCFullYear();
    const baseline = referenceYear(year);
    const start = Date.UTC(year, 0, 1);
    const pairs = [];

    for (let day = start; day <= end.getTime(); day += DAY) {
        const date = isoDay(new Date(day));
        // Both years use the same calendar days, including in leap years.
        if (!date.endsWith("02-29")) pairs.push([`${baseline}${date.slice(4)}`, date]);
    }

    const [base, latest] = await Promise.all([
        loadTemperature(`${baseline}-01-01`, pairs.at(-1)[0]),
        loadTemperature(`${year}-01-01`, isoDay(end))
    ]);
    const period = `Jan 1–${dayLabel.format(end)} in each year · ${pairs.length} matched days`;
    const definitions = [
        ["tempMax", TEMP_MAX, values => Math.max(...values)],
        ["tempMean", TEMP_MEAN, values => values.reduce((sum, value) => sum + value, 0) / values.length]
    ];
    const comparisons = definitions.map(([id, field, summarize]) => {
        try {
            return { id, values: temperatureComparison(base, latest, field, pairs, summarize) };
        } catch {
            return { id };
        }
    });

    const values = comparisons.flatMap(comparison => comparison.values ?? []);
    const scale = values.length ? plotScale(values, temperature.minStep) : null;
    return comparisons.map(({ id, values }) => {
        if (!values) return showUnavailable(id);
        showComparison(id, temperature, values, [baseline, year], period, scale);
        return true;
    });
}

function monthKey(year, month) {
    return `${year}-${String(month).padStart(2, "0")}`;
}

function monthOffset(date, offset) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}

function monthlyValues(rows, bounds) {
    const values = new Map();
    for (const [rawYear, rawMonth, rawValue] of rows) {
        const year = Number(rawYear);
        const month = Number(rawMonth);
        const value = rawValue == null || String(rawValue).trim() === "" ? NaN : Number(rawValue);
        if (Number.isInteger(year) && year >= 1900 && Number.isInteger(month) &&
            month >= 1 && month <= 12 && Number.isFinite(value) &&
            value >= bounds[0] && value <= bounds[1]) {
            values.set(monthKey(year, month), value);
        }
    }
    return values;
}

function showMonthlyComparison(id, metric, today, values, detail) {
    for (let offset = 1; offset <= MONTH_LOOKBACK; offset++) {
        const date = monthOffset(today, -offset);
        const year = date.getUTCFullYear();
        const baseline = referenceYear(year);
        const month = date.getUTCMonth() + 1;
        const before = values.get(monthKey(baseline, month));
        const after = values.get(monthKey(year, month));
        if (before !== undefined && after !== undefined) {
            const period = `${monthLabel.format(date)} in each year · ${detail}`;
            showComparison(id, metric, [before, after], [baseline, year], period);
            return true;
        }
    }
    return showUnavailable(id, "No matched data for the last six complete months.");
}

async function loadCarbon(today) {
    const csv = await request("https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_gl.csv", "text");
    const rows = csv.split(/\r?\n/).filter(line => line.trim() && !line.trimStart().startsWith("#"));
    const header = rows.shift()?.split(",").map(column => column.trim()) ?? [];
    const indices = ["year", "month", "average"].map(column => header.indexOf(column));
    if (indices.includes(-1)) throw new Error("Unrecognized NOAA CO₂ columns.");
    const data = rows.map(row => {
        const columns = row.split(",");
        return indices.map(index => columns[index]);
    });
    return showMonthlyComparison("co2", carbon, today, monthlyValues(data, [250, 700]), "monthly global mean");
}

async function loadSeaLevel(today) {
    const from = referenceYear(monthOffset(today, -MONTH_LOOKBACK).getUTCFullYear());
    const through = new Date(monthOffset(today, 0).getTime() - DAY);
    const params = new URLSearchParams({
        product: "monthly_mean",
        application: "climate_artifact",
        begin_date: `${from}0101`,
        end_date: isoDay(through).replaceAll("-", ""),
        datum: "MLLW",
        station: "9410230",
        time_zone: "lst",
        units: "english",
        format: "json"
    });
    const payload = await request(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params}`);
    if (!Array.isArray(payload.data)) throw new Error("Invalid NOAA water level series.");
    const rows = payload.data.map(row => [row.year, row.month, row.MSL]);
    return showMonthlyComparison("sea", seaLevel, today, monthlyValues(rows, [-5, 15]),
        "monthly mean above mean lower low water");
}

function plotScale(values, minStep) {
    const low = Math.min(...values);
    const high = Math.max(...values);
    // Four intervals, with at least half an interval of space beyond the dots.
    const required = Math.max(minStep, (high - low) / 3);
    const magnitude = 10 ** Math.floor(Math.log10(required));
    const step = [1, 2, 2.5, 5, 10].map(value => value * magnitude).find(value => value >= required);
    return { min: (Math.round((low + high) / (2 * step)) - 2) * step, step };
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function showComparison(id, metric, values, years, period, scale = plotScale(values, metric.minStep)) {
    const panel = document.querySelector(`#${id} .comparison`);
    const valueFormat = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: metric.digits, maximumFractionDigits: metric.digits
    });
    const deltaFormat = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: metric.digits, maximumFractionDigits: metric.digits, signDisplay: "exceptZero"
    });
    const details = element("dl", "values");
    const plot = element("div", "dot-plot");
    plot.setAttribute("aria-hidden", "true");

    for (const [index, year] of years.entries()) {
        const className = index === 0 ? "reference" : "latest";
        const value = values[index];
        const entry = element("div", className);
        entry.append(element("dt", "", year), element("dd", "", `${valueFormat.format(value)} ${metric.unit}`));
        details.append(entry);

        const track = element("div", `track ${className}`);
        const dot = element("span", "dot");
        dot.style.left = `${(value - scale.min) / (4 * scale.step) * 100}%`;
        track.append(dot);
        plot.append(element("span", "", year), track);
    }

    const change = element("div");
    change.append(element("dt", "", "Change"),
        element("dd", "", `${deltaFormat.format(values[1] - values[0])} ${metric.unit}`));
    details.append(change);

    const ticks = element("div", "ticks");
    const tickFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: metric.tickDigits ?? 0 });
    for (let tick = 0; tick <= 4; tick++) {
        const label = element("span", "", tickFormat.format(scale.min + tick * scale.step));
        label.style.left = `${tick * 25}%`;
        ticks.append(label);
    }
    plot.append(ticks);
    panel.replaceChildren(element("p", "period", period), details, plot);
}

function showUnavailable(id, message = "Data unavailable from the source. Try refreshing.") {
    document.querySelector(`#${id} .comparison`).replaceChildren(element("p", "period", message));
    return false;
}

async function fetchMetrics() {
    const today = laCalendarDay(new Date());
    document.body.classList.add("has-run");
    results.hidden = false;
    document.getElementById("about").hidden = false;
    results.setAttribute("aria-busy", "true");
    runButton.disabled = true;
    runButton.textContent = "Loading…";
    status.textContent = "Loading climate data…";
    for (const panel of results.querySelectorAll(".comparison")) {
        panel.replaceChildren(element("p", "period", "Loading…"));
    }

    const loaded = (await Promise.all([
        loadTemperatures(today).catch(() => ["tempMax", "tempMean"].map(id => showUnavailable(id))),
        loadCarbon(today).catch(() => showUnavailable("co2")),
        loadSeaLevel(today).catch(() => showUnavailable("sea"))
    ])).flat().filter(Boolean).length;

    results.setAttribute("aria-busy", "false");
    runButton.disabled = false;
    runButton.textContent = "Refresh data";
    status.textContent = loaded === 4 ? "All four comparisons loaded." : `${loaded} of 4 comparisons loaded.`;
}

updateTimer();
setInterval(updateTimer, 1000);
runButton.addEventListener("click", fetchMetrics);
