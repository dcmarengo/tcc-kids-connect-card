import React, { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

window.storage = {
  async get(key, shared) {
    const { data, error } = await supabase
      .from("txc_kids_storage")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { key, value: data.value, shared };
  },
  async set(key, value, shared) {
    const { error } = await supabase
      .from("txc_kids_storage")
      .upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
    return { key, value, shared };
  },
  async delete(key, shared) {
    const { error } = await supabase
      .from("txc_kids_storage")
      .delete()
      .eq("key", key);
    if (error) throw error;
    return { key, deleted: true, shared };
  }
};

// ─── Storage keys (distinct from adult app) ───────────────
const ENTRIES_KEY = "tcc_kids_entries";
const SUBMITTED_KEY = "tcc_kids_submitted";
const GROUP_KEY = "tcc_kids_group_name";

// ─── Helpers ──────────────────────────────────────────────
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Group naming: "Friday-or-later means the upcoming Sunday" rule (matches adult app)
const relevantSundayKey = () => {
  const d = new Date();
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  if (day >= 5) {
    // Friday or Saturday — upcoming Sunday
    d.setDate(d.getDate() + (7 - day));
  } else {
    // Sunday through Thursday — most recent Sunday
    d.setDate(d.getDate() - day);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const defaultGroupName = () => `KIDS-FTG-${relevantSundayKey()}`;

const splitName = (full) => {
  const trimmed = (full || "").trim();
  if (!trimmed) return { first: "", last: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return {
    first: parts.slice(0, -1).join(" "),
    last: parts[parts.length - 1],
  };
};

const formatDate = (iso) => new Date(iso).toLocaleDateString("en-US", {
  weekday: "long", month: "long", day: "numeric", year: "numeric"
});
const formatTime = (iso) => new Date(iso).toLocaleTimeString("en-US", {
  hour: "numeric", minute: "2-digit"
});
const formatPhone = (raw) => {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1")) return `${digits.slice(1,4)}-${digits.slice(4,7)}-${digits.slice(7)}`;
  return raw;
};

// ─── Options ──────────────────────────────────────────────
const GRADE_OPTIONS = [
  "Nursery (0–12 mo)",
  "Toddler (1 yo)",
  "Toddler (2 yo)",
  "PreK-3",
  "PreK-4",
  "Kindergarten",
  "1st Grade",
  "2nd Grade",
  "3rd Grade",
  "4th Grade",
  "5th Grade",
  "6th Grade",
];

const GENDER_OPTIONS = ["M", "F"];

const INTERESTED_OPTIONS = [
  { value: "serving",       label: "Serving" },
  { value: "growth-groups", label: "Growth Groups" },
  { value: "membership",    label: "Membership" },
  { value: "events",        label: "Events" },
];

const SOURCES = [
  { value: "kids-checkin",       label: "Kids Check-In" },
  { value: "preschool-checkin",  label: "Preschool Check-In" },
  { value: "elementary-checkin", label: "Elementary Check-In" },
  { value: "preteens-checkin",   label: "Preteens Check-In" },
];

// ─── Main App ─────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("add");
  const [entries, setEntries] = useState([]);
  const [submittedBatches, setSubmittedBatches] = useState([]);
  const [groupName, setGroupName] = useState(defaultGroupName());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [entRes, subRes, grpRes] = await Promise.all([
          window.storage.get(ENTRIES_KEY, true).catch(() => null),
          window.storage.get(SUBMITTED_KEY, true).catch(() => null),
          window.storage.get(GROUP_KEY, true).catch(() => null),
        ]);
        setEntries(entRes ? JSON.parse(entRes.value) : []);
        setSubmittedBatches(subRes ? JSON.parse(subRes.value) : []);
        if (grpRes) {
          const expected = defaultGroupName();
          // Auto-rollover: if saved name is from a stale week, refresh to current default
          if (grpRes.value.startsWith("KIDS-FTG-") && grpRes.value !== expected) {
            setGroupName(expected);
            await window.storage.set(GROUP_KEY, expected, true);
          } else {
            setGroupName(grpRes.value);
          }
        }
      } catch (e) {
        setError("Could not load saved entries.");
      } finally { setLoading(false); }
    })();
  }, []);

  const persistGroupName = async (name) => {
    setGroupName(name);
    try { await window.storage.set(GROUP_KEY, name, true); }
    catch (e) { /* non-critical */ }
  };

  const persistEntries = async (next) => {
    setEntries(next);
    try { await window.storage.set(ENTRIES_KEY, JSON.stringify(next), true); }
    catch (e) { setError("Save failed. Try again."); }
  };
  const persistBatches = async (next) => {
    setSubmittedBatches(next);
    try { await window.storage.set(SUBMITTED_KEY, JSON.stringify(next), true); }
    catch (e) { setError("Save failed."); }
  };

  const addOrUpdateEntry = async (data) => {
    if (editingId) {
      const next = entries.map(e => e.id === editingId ? { ...e, ...data } : e);
      await persistEntries(next);
      setEditingId(null);
    } else {
      const newEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
        timestamp: new Date().toISOString(),
        ...data
      };
      await persistEntries([newEntry, ...entries]);
    }
  };

  const deleteEntry = async (id) => {
    await persistEntries(entries.filter(e => e.id !== id));
  };

  const submitBatch = async () => {
    if (entries.length === 0) return;
    const batch = {
      id: `batch-${Date.now()}`,
      submittedAt: new Date().toISOString(),
      groupName: groupName,
      count: entries.length,
      entries: entries
    };
    await persistBatches([batch, ...submittedBatches]);
    await persistEntries([]);
    return batch;
  };

  const todayEntries = entries.filter(e => e.timestamp.startsWith(todayKey()));

  if (loading) return (
    <div style={S.app}>
      <div style={S.loadingScreen}>
        <div style={S.loadingDot}></div>
        <div style={{...S.loadingDot, animationDelay: "0.15s"}}></div>
        <div style={{...S.loadingDot, animationDelay: "0.3s"}}></div>
      </div>
      <style>{keyframes}</style>
    </div>
  );

  return (
    <div style={S.app}>
      <style>{keyframes}</style>
      <Header view={view} setView={setView} entryCount={todayEntries.length} />
      {error && (
        <div style={S.errorBar} onClick={() => setError(null)}>
          {error} · tap to dismiss
        </div>
      )}
      <main style={S.main}>
        {view === "add" && (
          <AddEntryView
            onSave={addOrUpdateEntry}
            editingEntry={editingId ? entries.find(e => e.id === editingId) : null}
            onCancelEdit={() => setEditingId(null)}
          />
        )}
        {view === "batch" && (
          <BatchView
            entries={todayEntries}
            groupName={groupName}
            onChangeGroupName={persistGroupName}
            onEdit={(id) => { setEditingId(id); setView("add"); }}
            onDelete={deleteEntry}
            onSubmit={() => setView("submit")}
          />
        )}
        {view === "submit" && (
          <SubmitView
            entries={todayEntries}
            groupName={groupName}
            onChangeGroupName={persistGroupName}
            onConfirm={submitBatch}
            onBack={() => setView("batch")}
            submittedBatches={submittedBatches}
            goHome={() => setView("add")}
          />
        )}
      </main>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────
function Header({ view, setView, entryCount }) {
  return (
    <header style={S.header}>
      <div style={S.headerInner}>
        <div style={S.brand}>
          <img
          src="data:image/png;base64,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"
          alt="The Cross Church"
          style={S.logo}
          />
          <div className="brand-secondary" style={S.brandDivider}></div>
          <div className="brand-secondary" style={S.brandLabel}>KIDS Guest</div>
        </div>
        <nav style={S.nav}>
          <NavBtn active={view === "add"} onClick={() => setView("add")} label="Add" />
          <NavBtn active={view === "batch"} onClick={() => setView("batch")} label="Batch" badge={entryCount} />
          <NavBtn active={view === "submit"} onClick={() => setView("submit")} label="Submit" />
        </nav>
      </div>
    </header>
  );
}

function NavBtn({ active, onClick, label, badge }) {
  return (
    <button onClick={onClick} style={{...S.navBtn, ...(active ? S.navBtnActive : {})}}>
      {label}
      {badge > 0 && <span style={S.badge}>{badge}</span>}
    </button>
  );
}

// ─── Add Entry View ───────────────────────────────────────
const blankChild = () => ({
  name: "", birthday: "", grade: "", gender: "",
  allergies: "", specialNeeds: "", classAssigned: ""
});

function AddEntryView({ onSave, editingEntry, onCancelEdit }) {
  const blank = {
    parent1Name: "", parent1Phone: "", parent1Email: "",
    parent2Name: "", parent2Phone: "", parent2Email: "",
    address: "", apt: "", city: "", state: "TX", zip: "",
    interestedIn: [],
    children: [blankChild()],
    additionalNotes: "",
    greeter: "",
    source: "kids-checkin",
    consentGiven: true,
  };

  const normalize = (e) => {
    const kids = (e.children || []).map(c => ({ ...blankChild(), ...c }));
    if (kids.length === 0) kids.push(blankChild());
    return { ...blank, ...e, children: kids, interestedIn: e.interestedIn || [] };
  };

  const [form, setForm] = useState(editingEntry ? normalize(editingEntry) : blank);
  const [justSaved, setJustSaved] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    setForm(editingEntry ? normalize(editingEntry) : blank);
    setErrors({});
  }, [editingEntry]);

  const set = (k) => (e) => {
    const val = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm({ ...form, [k]: val });
    if (errors[k]) setErrors({ ...errors, [k]: null });
  };

  const setChild = (idx, field) => (e) => {
    const next = [...form.children];
    next[idx] = { ...next[idx], [field]: e.target.value };
    setForm({ ...form, children: next });
  };

  const addChild = () => {
    if (form.children.length < 4) {
      setForm({ ...form, children: [...form.children, blankChild()] });
    }
  };
  const removeChild = (idx) => {
    if (form.children.length > 1) {
      const next = form.children.filter((_, i) => i !== idx);
      setForm({ ...form, children: next });
    }
  };

  const toggleInterested = (value) => {
    const next = form.interestedIn.includes(value)
      ? form.interestedIn.filter(v => v !== value)
      : [...form.interestedIn, value];
    setForm({ ...form, interestedIn: next });
  };

  const validate = () => {
    const errs = {};
    if (!form.parent1Name.trim()) errs.parent1Name = "Parent 1 name required";
    const p1digits = (form.parent1Phone || "").replace(/\D/g, "");
    if (p1digits.length < 10) errs.parent1Phone = "Parent 1 phone needs 10 digits";
    if (form.parent1Email && !/^\S+@\S+\.\S+$/.test(form.parent1Email)) errs.parent1Email = "Invalid email";

    // Parent 2 optional, but if provided, validate
    if (form.parent2Phone) {
      const p2digits = form.parent2Phone.replace(/\D/g, "");
      if (p2digits.length < 10) errs.parent2Phone = "Parent 2 phone needs 10 digits";
    }
    if (form.parent2Email && !/^\S+@\S+\.\S+$/.test(form.parent2Email)) errs.parent2Email = "Invalid email";

    // At least one child with a name required
    const validChildren = form.children.filter(c => c.name.trim());
    if (validChildren.length === 0) errs.children = "At least one child name required";

    if (!form.consentGiven) errs.consentGiven = "Consent must be confirmed";
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    const cleaned = {
      ...form,
      parent1Phone: formatPhone(form.parent1Phone),
      parent2Phone: form.parent2Phone ? formatPhone(form.parent2Phone) : "",
      // Drop empty children rows
      children: form.children.filter(c => c.name.trim()),
    };
    await onSave(cleaned);
    setForm(blank);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2200);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const isEditing = !!editingEntry;

  return (
    <div style={S.viewWrap}>
      <div style={S.viewHeader}>
        <div style={S.viewEyebrow}>{isEditing ? "EDITING FAMILY" : "NEW FAMILY"}</div>
        <h1 style={S.viewTitle}>
          {isEditing ? "Update family details." : "Enter family details."}
        </h1>
        <p style={S.viewSubtitle}>
          {isEditing
            ? "Make your changes and save to update this entry."
            : "One card per family, up to 4 children. Saved locally until you submit the full batch."}
        </p>
      </div>

      <div style={S.form}>

        {/* ═══ PARENT/GUARDIAN 1 ═══ */}
        <SectionLabel>PARENT / GUARDIAN #1</SectionLabel>
        <div style={S.paperBlock}>
          <PaperRow label="NAME" required error={errors.parent1Name}>
            <input style={S.paperInput} value={form.parent1Name} onChange={set("parent1Name")} autoComplete="off" />
          </PaperRow>
          <PaperRow label="PHONE" required error={errors.parent1Phone}>
            <input style={S.paperInput} value={form.parent1Phone} onChange={set("parent1Phone")} inputMode="tel" autoComplete="off" />
          </PaperRow>
          <PaperRow label="EMAIL" error={errors.parent1Email} isLast>
            <input style={S.paperInput} type="email" value={form.parent1Email} onChange={set("parent1Email")} autoComplete="off" />
          </PaperRow>
        </div>

        {/* ═══ PARENT/GUARDIAN 2 (optional) ═══ */}
        <SectionLabel>PARENT / GUARDIAN #2 <span style={S.optional}>(optional)</span></SectionLabel>
        <div style={S.paperBlock}>
          <PaperRow label="NAME">
            <input style={S.paperInput} value={form.parent2Name} onChange={set("parent2Name")} autoComplete="off" />
          </PaperRow>
          <PaperRow label="PHONE" error={errors.parent2Phone}>
            <input style={S.paperInput} value={form.parent2Phone} onChange={set("parent2Phone")} inputMode="tel" autoComplete="off" />
          </PaperRow>
          <PaperRow label="EMAIL" error={errors.parent2Email} isLast>
            <input style={S.paperInput} type="email" value={form.parent2Email} onChange={set("parent2Email")} autoComplete="off" />
          </PaperRow>
        </div>

        {/* ═══ FAMILY ADDRESS ═══ */}
        <SectionLabel>FAMILY ADDRESS</SectionLabel>
        <div style={S.paperBlock}>
          <PaperRow label="STREET">
            <input style={S.paperInput} value={form.address} onChange={set("address")} autoComplete="off" />
          </PaperRow>
          <PaperRow label="APT #">
            <input style={S.paperInput} value={form.apt} onChange={set("apt")} autoComplete="off" />
          </PaperRow>
          <div style={S.paperRowSplit}>
            <div style={{...S.paperRow, flex: 2, borderBottom: "none", borderRight: `1px solid ${colors.hair}`}}>
              <span style={S.paperLabel}>CITY</span>
              <input style={S.paperInput} value={form.city} onChange={set("city")} autoComplete="off" />
            </div>
            <div style={{...S.paperRow, flex: 1, borderBottom: "none", borderRight: `1px solid ${colors.hair}`}}>
              <span style={S.paperLabel}>STATE</span>
              <input style={S.paperInput} value={form.state} onChange={set("state")} autoComplete="off" />
            </div>
            <div style={{...S.paperRow, flex: 1, borderBottom: "none"}}>
              <span style={S.paperLabel}>ZIP</span>
              <input style={S.paperInput} value={form.zip} onChange={set("zip")} inputMode="numeric" autoComplete="off" />
            </div>
          </div>
        </div>

        {/* ═══ INTERESTED IN ═══ */}
        <SectionLabel>AS A PARENT, I AM INTERESTED IN LEARNING ABOUT</SectionLabel>
        <div style={S.tellMeGrid}>
          {INTERESTED_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggleInterested(opt.value)}
              style={{
                ...S.tellMeBtn,
                ...(form.interestedIn.includes(opt.value) ? S.tellMeBtnActive : {})
              }}
            >
              <span style={{
                ...S.tellMeCheck,
                ...(form.interestedIn.includes(opt.value) ? S.tellMeCheckActive : {})
              }}>
                {form.interestedIn.includes(opt.value) && "✓"}
              </span>
              <span>{opt.label.toUpperCase()}</span>
            </button>
          ))}
        </div>

        {/* ═══ CHILDREN ═══ */}
        <SectionLabel>CHILDREN</SectionLabel>
        {errors.children && <div style={S.errorText}>{errors.children}</div>}

        {form.children.map((child, idx) => (
          <div key={idx} style={S.childBlock}>
            <div style={S.childHeader}>
              <div style={S.childHeaderLabel}>CHILD #{idx + 1}</div>
              {form.children.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeChild(idx)}
                  style={S.btnSmGhost}
                >Remove</button>
              )}
            </div>
            <div style={S.paperBlock}>
              <PaperRow label="NAME">
                <input style={S.paperInput} value={child.name} onChange={setChild(idx, "name")} autoComplete="off" />
              </PaperRow>
              <div style={S.paperRowSplit}>
                <div style={{...S.paperRow, flex: 1, borderBottom: "none", borderRight: `1px solid ${colors.hair}`}}>
                  <span style={S.paperLabel}>BIRTHDAY</span>
                  <input
                    style={S.paperInput}
                    type="date"
                    value={child.birthday}
                    onChange={setChild(idx, "birthday")}
                  />
                </div>
                <div style={{...S.paperRow, flex: 1, borderBottom: "none", borderRight: `1px solid ${colors.hair}`}}>
                  <span style={S.paperLabel}>GRADE</span>
                  <select
                    style={S.paperInput}
                    value={child.grade}
                    onChange={setChild(idx, "grade")}
                  >
                    <option value="">—</option>
                    {GRADE_OPTIONS.map(g => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
                <div style={{...S.paperRow, flex: 0.6, borderBottom: "none"}}>
                  <span style={S.paperLabel}>M/F</span>
                  <select
                    style={S.paperInput}
                    value={child.gender}
                    onChange={setChild(idx, "gender")}
                  >
                    <option value="">—</option>
                    {GENDER_OPTIONS.map(g => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
              </div>
              <PaperRow label="ALLERGIES / MEDICAL">
                <input style={S.paperInput} value={child.allergies} onChange={setChild(idx, "allergies")} placeholder="e.g. peanuts, none" autoComplete="off" />
              </PaperRow>
              <PaperRow label="SPECIAL NEEDS">
                <input style={S.paperInput} value={child.specialNeeds} onChange={setChild(idx, "specialNeeds")} autoComplete="off" />
              </PaperRow>
              <PaperRow label="CLASS" isLast>
                <input style={S.paperInput} value={child.classAssigned} onChange={setChild(idx, "classAssigned")} placeholder="e.g. Owls, Lions" autoComplete="off" />
              </PaperRow>
            </div>
          </div>
        ))}

        {form.children.length < 4 && (
          <button onClick={addChild} style={S.btnGhost} type="button">
            + Add Another Child
          </button>
        )}

        {/* ═══ ADDITIONAL NOTES ═══ */}
        <SectionLabel>ADDITIONAL NOTES</SectionLabel>
        <div style={S.paperBlock}>
          <PaperRow label="NOTES" isLast>
            <textarea style={S.paperTextarea} value={form.additionalNotes} onChange={set("additionalNotes")} rows={2} />
          </PaperRow>
        </div>

        {/* ═══ WELCOME TEAM (intake-only) ═══ */}
        <div style={S.intakeOnly}>
          <div style={S.intakeOnlyLabel}>FOR WELCOME TEAM</div>
          <div style={S.paperBlock}>
            <PaperRow label="GREETER" inline>
              <input style={S.paperInput} value={form.greeter} onChange={set("greeter")} autoComplete="off" />
            </PaperRow>
            <PaperRow label="SOURCE" inline>
              <select style={S.paperInput} value={form.source} onChange={set("source")}>
                {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </PaperRow>
          </div>
        </div>

        {/* ═══ CONSENT ═══ */}
        <div style={S.consentBox}>
          <label style={S.checkboxRow}>
            <input
              type="checkbox"
              checked={form.consentGiven}
              onChange={set("consentGiven")}
              style={S.checkbox}
            />
            <span style={{ lineHeight: 1.5 }}>
              <strong>SMS consent confirmed.</strong> Parent/guardian provided phone on the guest card or verbally agreed to a welcome text about their child's visit. Both parents on the card will receive the welcome text.
            </span>
          </label>
          {errors.consentGiven && <div style={S.errorText}>{errors.consentGiven}</div>}
        </div>

        <div style={S.actions}>
          {isEditing && (
            <button onClick={onCancelEdit} style={S.btnGhost}>Cancel Edit</button>
          )}
          <button onClick={handleSubmit} style={S.btnPrimary}>
            {isEditing ? "Update Family" : "Save Family"}
          </button>
        </div>

        {justSaved && (
          <div style={S.savedToast}>
            ✓ Saved. Form cleared for next family.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Form pieces ──────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={S.sectionLabelWrap}>
      <div style={S.sectionLabelMark}></div>
      <div style={S.sectionLabel}>{children}</div>
    </div>
  );
}

function PaperRow({ label, required, error, children, inline, isLast }) {
  return (
    <div style={{
      ...S.paperRow,
      ...(inline ? { borderBottom: "none" } : {}),
      ...(isLast ? { borderBottom: "none" } : {})
    }}>
      {label !== undefined && (
        <span style={S.paperLabel}>
          {label}
          {required && <span style={S.requiredMark}> *</span>}
        </span>
      )}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {children}
        {error && <div style={S.errorText}>{error}</div>}
      </div>
    </div>
  );
}

// ─── Batch View ───────────────────────────────────────────
function BatchView({ entries, groupName, onChangeGroupName, onEdit, onDelete, onSubmit }) {
  const sourceCounts = entries.reduce((acc, e) => {
    acc[e.source] = (acc[e.source] || 0) + 1;
    return acc;
  }, {});

  const totalKids = entries.reduce((sum, e) => sum + (e.children?.length || 0), 0);

  return (
    <div style={S.viewWrap}>
      <div style={S.viewHeader}>
        <div style={S.viewEyebrow}>TODAY'S BATCH · {formatDate(new Date().toISOString()).toUpperCase()}</div>
        <h1 style={S.viewTitle}>
          {entries.length === 0
            ? "No families yet today."
            : `${entries.length} ${entries.length === 1 ? "family" : "families"}, ${totalKids} ${totalKids === 1 ? "child" : "children"}.`}
        </h1>
        <p style={S.viewSubtitle}>
          {entries.length === 0
            ? "Add your first family from the Add tab. Entries will appear here as you save them."
            : "Review, edit, or remove entries before submitting the full batch."}
        </p>
      </div>

      {entries.length > 0 && (
        <>
          <GroupNameCard groupName={groupName} onChange={onChangeGroupName} />

          <div style={S.summaryBar}>
            {Object.entries(sourceCounts).map(([src, count]) => {
              const label = SOURCES.find(s => s.value === src)?.label || src;
              return (
                <div key={src} style={S.summaryItem}>
                  <span style={S.summaryCount}>{count}</span>
                  <span style={S.summaryLabel}>{label}</span>
                </div>
              );
            })}
          </div>

          <div style={S.entryList}>
            {entries.map(e => (
              <EntryCard key={e.id} entry={e} onEdit={() => onEdit(e.id)} onDelete={() => onDelete(e.id)} />
            ))}
          </div>

          <div style={S.actions}>
            <button onClick={onSubmit} style={S.btnPrimary}>
              Submit Batch ({entries.length}) →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function GroupNameCard({ groupName, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(groupName);

  useEffect(() => { setDraft(groupName); }, [groupName]);

  const save = () => {
    const trimmed = draft.trim() || defaultGroupName();
    onChange(trimmed);
    setEditing(false);
  };

  return (
    <div style={S.groupCard}>
      <div style={S.groupCardLeft}>
        <div style={S.groupCardLabel}>GLOO GROUP</div>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(groupName); setEditing(false); } }}
            style={S.groupCardInput}
          />
        ) : (
          <div style={S.groupCardName}>{groupName}</div>
        )}
        <div style={S.groupCardHint}>
          Parents will be added to this group in Gloo. Default: <code style={S.groupCardCode}>KIDS-FTG-YYYY-MM-DD</code>
        </div>
      </div>
      {!editing && (
        <button onClick={() => setEditing(true)} style={S.btnSm}>
          Edit
        </button>
      )}
    </div>
  );
}

function EntryCard({ entry, onEdit, onDelete }) {
  const sourceLabel = SOURCES.find(s => s.value === entry.source)?.label || entry.source;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const interestedLabels = (entry.interestedIn || []).map(v =>
    INTERESTED_OPTIONS.find(o => o.value === v)?.label || v
  );

  const familyLabel = entry.parent2Name
    ? `${entry.parent1Name} & ${entry.parent2Name}`
    : entry.parent1Name;

  return (
    <div style={S.entryCard}>
      <div style={S.entryHeader}>
        <div style={S.entryName}>{familyLabel}</div>
        <div style={S.entryTime}>{formatTime(entry.timestamp)}</div>
      </div>
      <div style={S.entryDetails}>
        <span style={S.entryDetail}>{entry.parent1Phone}</span>
        {entry.parent2Phone && <span style={S.entryDetail}>/ {entry.parent2Phone}</span>}
        {entry.parent1Email && <span style={S.entryDetail}>{entry.parent1Email}</span>}
        <span style={S.entryTag}>{sourceLabel}</span>
      </div>
      {(entry.address || entry.city) && (
        <div style={S.entryMeta}>
          {[entry.address, entry.apt && `Apt ${entry.apt}`, entry.city, entry.state, entry.zip].filter(Boolean).join(", ")}
        </div>
      )}
      {entry.children && entry.children.length > 0 && (
        <div style={S.childrenList}>
          {entry.children.map((child, idx) => (
            <div key={idx} style={S.childSummary}>
              <strong>{child.name}</strong>
              {child.grade && ` · ${child.grade}`}
              {child.gender && ` (${child.gender})`}
              {child.classAssigned && <span style={S.classTag}> → {child.classAssigned}</span>}
              {child.allergies && child.allergies.toLowerCase() !== "none" && (
                <div style={S.allergyFlag}>⚠ Allergies: {child.allergies}</div>
              )}
              {child.specialNeeds && child.specialNeeds.toLowerCase() !== "none" && (
                <div style={S.allergyFlag}>Special needs: {child.specialNeeds}</div>
              )}
            </div>
          ))}
        </div>
      )}
      {interestedLabels.length > 0 && (
        <div style={S.tagRow}>
          {interestedLabels.map(l => <span key={l} style={S.entryTagSecondary}>{l}</span>)}
        </div>
      )}
      {entry.greeter && <div style={S.entryMeta}>Greeter: {entry.greeter}</div>}
      {entry.additionalNotes && (
        <div style={S.entryNotes}>
          <strong>Notes:</strong> {entry.additionalNotes}
        </div>
      )}
      <div style={S.entryActions}>
        <button onClick={onEdit} style={S.btnSm}>Edit</button>
        {confirmDelete ? (
          <>
            <button onClick={() => setConfirmDelete(false)} style={S.btnSm}>Cancel</button>
            <button onClick={onDelete} style={S.btnSmDanger}>Confirm Delete</button>
          </>
        ) : (
          <button onClick={() => setConfirmDelete(true)} style={S.btnSmGhost}>Delete</button>
        )}
      </div>
    </div>
  );
}

// ─── Submit View ──────────────────────────────────────────
function SubmitView({ entries, groupName, onChangeGroupName, onConfirm, onBack, submittedBatches, goHome }) {
  const [submitted, setSubmitted] = useState(false);
  const [batch, setBatch] = useState(null);
  const [copyStatus, setCopyStatus] = useState({});

  const copyToClipboard = async (content, key) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyStatus({ ...copyStatus, [key]: "copied" });
      setTimeout(() => setCopyStatus(prev => ({ ...prev, [key]: null })), 2000);
    } catch (e) {
      setCopyStatus({ ...copyStatus, [key]: "failed" });
      setTimeout(() => setCopyStatus(prev => ({ ...prev, [key]: null })), 2000);
    }
  };

  const escape = (val) => {
    if (val == null) return "";
    const s = String(val);
    if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  // ─── GLOO CSV ────────────────────────────────────────────
  // One row per parent who consented (up to 2 per family). Both get the welcome text.
  const buildGlooCSV = (rows, batchGroupName) => {
    const headers = [
      "Phone Number", "First Name", "Last Name",
      "Email (optional)", "Address (optional)", "Groups (optional)"
    ];
    const lines = [headers.join(",")];
    rows.forEach(r => {
      const addressFull = [r.address, r.apt && `Apt ${r.apt}`, r.city, r.state, r.zip].filter(Boolean).join(", ");

      // Parent 1 (always included since it's required)
      const p1 = splitName(r.parent1Name);
      lines.push([
        escape(r.parent1Phone),
        escape(p1.first),
        escape(p1.last),
        escape(r.parent1Email),
        escape(addressFull),
        escape(batchGroupName),
      ].join(","));

      // Parent 2 (only if provided)
      if (r.parent2Name && r.parent2Phone) {
        const p2 = splitName(r.parent2Name);
        lines.push([
          escape(r.parent2Phone),
          escape(p2.first),
          escape(p2.last),
          escape(r.parent2Email),
          escape(addressFull),
          escape(batchGroupName),
        ].join(","));
      }
    });
    return lines.join("\n");
  };

  // ─── REALM CSV (full family record) ──────────────────────
  // One row per family with all details preserved.
  const buildRealmCSV = (rows, batchGroupName) => {
    const headers = [
      "parent1_first_name", "parent1_last_name", "parent1_phone", "parent1_email",
      "parent2_first_name", "parent2_last_name", "parent2_phone", "parent2_email",
      "address", "apt", "city", "state", "zip",
      "interested_in",
      "child_count", "children_summary", "children_detail",
      "greeter", "source", "gloo_group",
      "additional_notes", "consent_given", "captured_at"
    ];
    const lines = [headers.join(",")];
    rows.forEach(r => {
      const p1 = splitName(r.parent1Name);
      const p2 = r.parent2Name ? splitName(r.parent2Name) : { first: "", last: "" };
      const kids = r.children || [];
      const childrenSummary = kids.map(c => `${c.name} (${c.grade}${c.gender ? " " + c.gender : ""})`).join("; ");
      const childrenDetail = kids.map(c => {
        const parts = [
          `Name: ${c.name}`,
          c.birthday && `DOB: ${c.birthday}`,
          c.grade && `Grade: ${c.grade}`,
          c.gender && `Gender: ${c.gender}`,
          c.allergies && `Allergies: ${c.allergies}`,
          c.specialNeeds && `Special needs: ${c.specialNeeds}`,
          c.classAssigned && `Class: ${c.classAssigned}`,
        ].filter(Boolean);
        return parts.join(" | ");
      }).join("  ///  ");

      lines.push([
        escape(p1.first),
        escape(p1.last),
        escape(r.parent1Phone),
        escape(r.parent1Email),
        escape(p2.first),
        escape(p2.last),
        escape(r.parent2Phone),
        escape(r.parent2Email),
        escape(r.address),
        escape(r.apt),
        escape(r.city),
        escape(r.state),
        escape(r.zip),
        escape((r.interestedIn || []).join("; ")),
        escape(kids.length),
        escape(childrenSummary),
        escape(childrenDetail),
        escape(r.greeter),
        escape(r.source),
        escape(batchGroupName),
        escape(r.additionalNotes),
        escape(r.consentGiven ? "yes" : "no"),
        escape(r.timestamp)
      ].join(","));
    });
    return lines.join("\n");
  };

  const downloadFile = (content, filename) => {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filenameForGloo = (date, name) => {
    const safe = (name || "KIDS-FTG").replace(/[^A-Za-z0-9_-]/g, "_");
    return `gloo-${safe}.csv`;
  };
  const filenameForRealm = (date, name) => {
    const safe = (name || "KIDS-FTG").replace(/[^A-Za-z0-9_-]/g, "_");
    return `realm-${safe}.csv`;
  };

  const downloadBoth = (rows, batchGroupName) => {
    downloadFile(buildGlooCSV(rows, batchGroupName), filenameForGloo(todayKey(), batchGroupName));
    setTimeout(() => {
      downloadFile(buildRealmCSV(rows, batchGroupName), filenameForRealm(todayKey(), batchGroupName));
    }, 400);
  };

  const printBatchSummary = (b) => {
    const win = window.open("", "_blank", "width=900,height=1000");
    if (!win) return;
    const dateLabel = formatDate(b.submittedAt);
    const timeLabel = formatTime(b.submittedAt);
    const totalKids = b.entries.reduce((sum, e) => sum + (e.children?.length || 0), 0);
    const rows = b.entries.map(e => {
      const kids = (e.children || []).map(c => {
        const bits = [c.name, c.grade, c.gender].filter(Boolean).join(" · ");
        const flags = [];
        if (c.allergies && c.allergies.toLowerCase() !== "none") flags.push(`Allergies: ${c.allergies}`);
        if (c.specialNeeds && c.specialNeeds.toLowerCase() !== "none") flags.push(`Special: ${c.specialNeeds}`);
        if (c.classAssigned) flags.push(`Class: ${c.classAssigned}`);
        return `<div><strong>${bits}</strong>${flags.length ? `<br/><span class="muted">${flags.join(" · ")}</span>` : ""}</div>`;
      }).join("");
      const parents = e.parent2Name
        ? `<div><strong>${e.parent1Name}</strong> · ${e.parent1Phone}</div><div><strong>${e.parent2Name}</strong> · ${e.parent2Phone}</div>`
        : `<div><strong>${e.parent1Name}</strong> · ${e.parent1Phone}</div>`;
      const addr = [e.address, e.apt && `Apt ${e.apt}`, e.city, e.state, e.zip].filter(Boolean).join(", ");
      const sourceLabel = SOURCES.find(s => s.value === e.source)?.label || e.source;
      return `
        <tr>
          <td>${parents}<div class="muted">${addr || ""}</div></td>
          <td>${kids || "—"}</td>
          <td>${sourceLabel}${e.greeter ? `<br/><span class="muted">Greeter: ${e.greeter}</span>` : ""}</td>
          <td>${e.additionalNotes || ""}</td>
        </tr>
      `;
    }).join("");

    const html = `<!DOCTYPE html>
<html><head><title>The Cross Church KIDS — ${b.groupName}</title>
<style>
  @page { size: letter landscape; margin: 0.5in; }
  body { font-family: Calibri, sans-serif; color: #1A1A1A; margin: 0; padding: 24px; }
  .eyebrow { font-size: 10px; letter-spacing: 4px; color: #1E3A8A; font-weight: 700; }
  h1 { font-family: Cambria, Georgia, serif; font-size: 28px; margin: 4px 0 4px; }
  .meta { color: #6B6B6B; font-size: 12px; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid #C8C4BB; }
  .meta strong { color: #1A1A1A; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { text-align: left; background: #F2EFE8; padding: 8px 10px; font-size: 9px; letter-spacing: 1px; color: #6B6B6B; border-bottom: 2px solid #1E3A8A; }
  td { padding: 10px; border-bottom: 1px solid #E5E1D8; vertical-align: top; }
  td .muted { color: #9A9A9A; font-size: 10px; }
  .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #C8C4BB; font-size: 10px; color: #9A9A9A; text-align: center; }
</style></head>
<body>
  <div class="eyebrow">THE CROSS CHURCH · KIDS GUEST BATCH</div>
  <h1>${b.groupName}</h1>
  <div class="meta">
    <strong>${b.count}</strong> ${b.count === 1 ? "family" : "families"} ·
    <strong>${totalKids}</strong> ${totalKids === 1 ? "child" : "children"} ·
    Submitted ${dateLabel} at ${timeLabel}
  </div>
  <table>
    <thead>
      <tr>
        <th>PARENTS / ADDRESS</th>
        <th>CHILDREN</th>
        <th>SOURCE / GREETER</th>
        <th>NOTES</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    Internal record — handle per privacy policy. SMS consent obtained at capture.
  </div>
  <script>setTimeout(() => window.print(), 250);</script>
</body></html>`;
    win.document.write(html);
    win.document.close();
  };

  const handleConfirm = async () => {
    const newBatch = await onConfirm();
    setBatch(newBatch);
    setSubmitted(true);
    downloadBoth(newBatch.entries, newBatch.groupName);
  };

  // ─── SUCCESS SCREEN ───────────────────────────────────────
  if (submitted && batch) {
    const glooFile = filenameForGloo(todayKey(), batch.groupName);
    const realmFile = filenameForRealm(todayKey(), batch.groupName);
    const totalKids = batch.entries.reduce((sum, e) => sum + (e.children?.length || 0), 0);
    const totalParents = batch.entries.reduce((sum, e) => sum + (e.parent2Name ? 2 : 1), 0);

    return (
      <div style={S.viewWrap}>
        <div style={S.successBlock}>
          <div style={S.successCheck}>✓</div>
          <div style={S.successEyebrow}>BATCH SUBMITTED</div>
          <h1 style={S.viewTitle}>{batch.count} {batch.count === 1 ? "family" : "families"} captured.</h1>
          <p style={S.viewSubtitle}>
            {totalKids} {totalKids === 1 ? "child" : "children"} · {totalParents} {totalParents === 1 ? "parent" : "parents"} will receive Molly's welcome text.<br/>
            Group: <code style={S.code}>{batch.groupName}</code>
          </p>

          <div style={S.fileGrid}>
            <div style={S.fileCard}>
              <div style={S.fileCardLabel}>FOR GLOO</div>
              <div style={S.fileCardName}>{glooFile}</div>
              <div style={S.fileCardHint}>
                One row per parent ({totalParents} total). Both parents on each card get the welcome text.
              </div>
              <div style={S.fileCardActions}>
                <button
                  onClick={() => downloadFile(buildGlooCSV(batch.entries, batch.groupName), glooFile)}
                  style={S.btnSm}
                >↓ Download</button>
                <button
                  onClick={() => copyToClipboard(buildGlooCSV(batch.entries, batch.groupName), "gloo")}
                  style={S.btnSm}
                >
                  {copyStatus.gloo === "copied" ? "✓ Copied" : copyStatus.gloo === "failed" ? "Copy failed" : "Copy"}
                </button>
              </div>
            </div>
            <div style={S.fileCard}>
              <div style={S.fileCardLabel}>FOR REALM</div>
              <div style={S.fileCardName}>{realmFile}</div>
              <div style={S.fileCardHint}>
                Full family record with both parents, all kids, allergies, class assignments. For Monday's Realm import.
              </div>
              <div style={S.fileCardActions}>
                <button
                  onClick={() => downloadFile(buildRealmCSV(batch.entries, batch.groupName), realmFile)}
                  style={S.btnSm}
                >↓ Download</button>
                <button
                  onClick={() => copyToClipboard(buildRealmCSV(batch.entries, batch.groupName), "realm")}
                  style={S.btnSm}
                >
                  {copyStatus.realm === "copied" ? "✓ Copied" : copyStatus.realm === "failed" ? "Copy failed" : "Copy"}
                </button>
              </div>
            </div>
          </div>

          <div style={S.actions}>
            <button
              onClick={() => printBatchSummary(batch)}
              style={S.btnGhost}
            >🖨 Print summary</button>
          </div>

          <div style={S.nextSteps}>
            <div style={S.nextStepsTitle}>NEXT STEPS</div>
            <ol style={S.nextStepsList}>
              <li>Confirm the Gloo group <code style={S.codeInline}>{batch.groupName}</code> exists (created by Thursday noon).</li>
              <li>In Gloo, navigate to Contacts → Import.</li>
              <li>Upload <code style={S.codeInline}>{glooFile}</code>. Columns map automatically.</li>
              <li>Confirm the import. Molly's welcome text fires per Gloo automation.</li>
              <li>Send <code style={S.codeInline}>{realmFile}</code> to the follow-up team for Monday's Realm import.</li>
            </ol>
          </div>

          <div style={S.actions}>
            <button onClick={goHome} style={S.btnPrimary}>Done — Start Next Sunday</button>
          </div>
        </div>

        {submittedBatches.length > 1 && (
          <div style={S.historySection}>
            <div style={S.historyTitle}>RECENT BATCHES</div>
            {submittedBatches.slice(1, 5).map(b => {
              const bGroup = b.groupName || `KIDS-FTG-${b.submittedAt.slice(0,10)}`;
              return (
                <div key={b.id} style={S.historyRow}>
                  <div>
                    <div style={S.historyDate}>{formatDate(b.submittedAt)}</div>
                    <div style={S.historyMeta}>
                      {b.count} families · {bGroup} · submitted {formatTime(b.submittedAt)}
                    </div>
                  </div>
                  <div style={{display: "flex", gap: 6}}>
                    <button
                      onClick={() => downloadFile(buildGlooCSV(b.entries, bGroup), filenameForGloo(b.submittedAt.slice(0,10), bGroup))}
                      style={S.btnSm}
                    >Gloo</button>
                    <button
                      onClick={() => downloadFile(buildRealmCSV(b.entries, bGroup), filenameForRealm(b.submittedAt.slice(0,10), bGroup))}
                      style={S.btnSm}
                    >Realm</button>
                    <button
                      onClick={() => printBatchSummary(b)}
                      style={S.btnSm}
                    >Print</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ─── EMPTY-STATE SCREEN ──────────────────────────────────
  if (entries.length === 0) {
    return (
      <div style={S.viewWrap}>
        <div style={S.viewHeader}>
          <div style={S.viewEyebrow}>NOTHING TO SUBMIT</div>
          <h1 style={S.viewTitle}>No families in today's batch.</h1>
          <p style={S.viewSubtitle}>Add at least one family before submitting.</p>
          <div style={S.actions}>
            <button onClick={goHome} style={S.btnPrimary}>Back to Add</button>
          </div>
        </div>
        {submittedBatches.length > 0 && (
          <div style={S.historySection}>
            <div style={S.historyTitle}>RECENT BATCHES</div>
            {submittedBatches.slice(0, 5).map(b => {
              const bGroup = b.groupName || `KIDS-FTG-${b.submittedAt.slice(0,10)}`;
              return (
                <div key={b.id} style={S.historyRow}>
                  <div>
                    <div style={S.historyDate}>{formatDate(b.submittedAt)}</div>
                    <div style={S.historyMeta}>
                      {b.count} families · {bGroup} · submitted {formatTime(b.submittedAt)}
                    </div>
                  </div>
                  <div style={{display: "flex", gap: 6}}>
                    <button
                      onClick={() => downloadFile(buildGlooCSV(b.entries, bGroup), filenameForGloo(b.submittedAt.slice(0,10), bGroup))}
                      style={S.btnSm}
                    >Gloo</button>
                    <button
                      onClick={() => downloadFile(buildRealmCSV(b.entries, bGroup), filenameForRealm(b.submittedAt.slice(0,10), bGroup))}
                      style={S.btnSm}
                    >Realm</button>
                    <button
                      onClick={() => printBatchSummary(b)}
                      style={S.btnSm}
                    >Print</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ─── CONFIRMATION SCREEN ──────────────────────────────────
  const totalKids = entries.reduce((sum, e) => sum + (e.children?.length || 0), 0);
  const totalParents = entries.reduce((sum, e) => sum + (e.parent2Name ? 2 : 1), 0);

  return (
    <div style={S.viewWrap}>
      <div style={S.viewHeader}>
        <div style={S.viewEyebrow}>READY TO SUBMIT</div>
        <h1 style={S.viewTitle}>Submit {entries.length} {entries.length === 1 ? "family" : "families"}?</h1>
        <p style={S.viewSubtitle}>
          {totalParents} parents will receive Molly's welcome text. Two CSVs will be generated: one for Gloo (welcome text), one for Realm (full family record).
        </p>
      </div>

      <GroupNameCard groupName={groupName} onChange={onChangeGroupName} />

      <div style={S.confirmBox}>
        <div style={S.confirmRow}>
          <div style={S.confirmLabel}>Families</div>
          <div style={S.confirmValue}>{entries.length}</div>
        </div>
        <div style={S.confirmRow}>
          <div style={S.confirmLabel}>Children</div>
          <div style={S.confirmValue}>{totalKids}</div>
        </div>
        <div style={S.confirmRow}>
          <div style={S.confirmLabel}>Parents receiving text</div>
          <div style={S.confirmValue}>{totalParents}</div>
        </div>
        <div style={S.confirmRow}>
          <div style={S.confirmLabel}>Gloo group</div>
          <div style={S.confirmValue}>{groupName}</div>
        </div>
        <div style={S.confirmRow}>
          <div style={S.confirmLabel}>Outputs</div>
          <div style={S.confirmValue}>
            {filenameForGloo(todayKey(), groupName)}<br/>
            {filenameForRealm(todayKey(), groupName)}
          </div>
        </div>
      </div>
      <div style={S.actions}>
        <button onClick={onBack} style={S.btnGhost}>← Back to Review</button>
        <button onClick={handleConfirm} style={S.btnPrimary}>Confirm & Download CSVs</button>
      </div>
    </div>
  );
}

// ─── Animations ───────────────────────────────────────────
const keyframes = `
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes pulse {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50%      { opacity: 1; transform: scale(1.2); }
}
@keyframes slideDown {
  from { opacity: 0; transform: translateY(-12px); }
  to   { opacity: 1; transform: translateY(0); }
}
* { box-sizing: border-box; }
input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: #1E3A8A !important;
  box-shadow: 0 0 0 3px rgba(30, 58, 138, 0.15) !important;
}
button {
  transition: all 0.15s ease;
}
button:hover {
  transform: translateY(-1px);
}
button:active {
  transform: translateY(0);
}
@media (max-width: 720px) {
  .brand-secondary { display: none !important; }
}
`;

// ─── Styles ───────────────────────────────────────────────
const colors = {
  navy:       "#1E3A8A",
  navyDeep:   "#162C66",
  navySoft:   "#E5EAF5",
  navyTint:   "#F0F3FA",
  ink:        "#1A1A1A",
  body:       "#2B2B2B",
  muted:      "#6B6B6B",
  subtle:     "#9A9A9A",
  paper:      "#FAFAF7",
  card:       "#FFFFFF",
  hair:       "#E5E1D8",
  hairDark:   "#C8C4BB",
  paperFill:  "#EFEAE0",
  paperFillLight: "#F5F1E7",
  danger:     "#A0392E",
  success:    "#2D6A4F",
  warning:    "#C9923D",
};

const fonts = {
  display: "'Cambria', 'Georgia', serif",
  body:    "'Calibri', -apple-system, system-ui, sans-serif",
};

const S = {
  app: { minHeight: "100vh", background: colors.paper, fontFamily: fonts.body, color: colors.body, fontSize: 16, lineHeight: 1.5 },
  loadingScreen: { height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 },
  loadingDot: { width: 10, height: 10, borderRadius: "50%", background: colors.navy, animation: "pulse 1s ease-in-out infinite" },
  header: {
    background: `linear-gradient(180deg, ${colors.navy} 0%, ${colors.navyDeep} 100%)`,
    color: colors.paper, position: "sticky", top: 0, zIndex: 10, boxShadow: "0 1px 0 rgba(0,0,0,0.06)",
  },
  headerInner: {
    maxWidth: 880, margin: "0 auto", padding: "18px 28px",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 24, flexWrap: "wrap",
  },
  brand: { display: "flex", alignItems: "center", gap: 16, minWidth: 0 },
  logo: { height: 32, width: "auto", display: "block", flexShrink: 0 },
  brandDivider: { width: 1, height: 24, background: "rgba(255,255,255,0.25)", flexShrink: 0 },
  brandLabel: { fontFamily: fonts.display, fontSize: 17, fontWeight: 400, fontStyle: "italic", color: "rgba(255,255,255,0.85)", whiteSpace: "nowrap" },

  nav: { display: "flex", gap: 4 },
  navBtn: {
    background: "transparent", border: "none", padding: "8px 14px",
    fontSize: 14, fontWeight: 600, fontFamily: fonts.body,
    color: "rgba(255,255,255,0.75)",
    cursor: "pointer", borderRadius: 6,
    display: "flex", alignItems: "center", gap: 8,
  },
  navBtnActive: { color: colors.paper, background: "rgba(255,255,255,0.18)" },
  badge: { background: colors.paper, color: colors.navy, fontSize: 11, padding: "2px 7px", borderRadius: 10, fontWeight: 700, minWidth: 22, textAlign: "center" },

  errorBar: { background: colors.danger, color: "#fff", padding: "10px 28px", textAlign: "center", fontSize: 14, cursor: "pointer", animation: "slideDown 0.3s ease" },

  main: { maxWidth: 760, margin: "0 auto", padding: "32px 28px 80px" },
  viewWrap: { animation: "fadeIn 0.3s ease" },
  viewHeader: { marginBottom: 28 },
  viewEyebrow: { fontSize: 10, letterSpacing: 4, color: colors.navy, fontWeight: 700, marginBottom: 12 },
  viewTitle: { fontFamily: fonts.display, fontSize: 32, fontWeight: 700, color: colors.ink, margin: "0 0 8px", lineHeight: 1.1, letterSpacing: -0.5 },
  viewSubtitle: { fontSize: 16, color: colors.muted, margin: 0, maxWidth: 560 },

  form: { background: colors.card, border: `1px solid ${colors.hair}`, borderRadius: 4, padding: 28 },

  sectionLabelWrap: { display: "flex", alignItems: "center", gap: 10, marginTop: 28, marginBottom: 12 },
  sectionLabelMark: { width: 4, height: 18, background: colors.navy, borderRadius: 1 },
  sectionLabel: { fontFamily: fonts.body, fontSize: 13, fontWeight: 800, letterSpacing: 1.5, color: colors.ink },
  optional: { fontWeight: 400, fontSize: 11, color: colors.subtle, letterSpacing: 0.5, marginLeft: 6, textTransform: "none" },

  paperBlock: { background: colors.paperFill, border: `1px solid ${colors.hairDark}`, borderRadius: 3, overflow: "hidden" },
  paperRow: { display: "flex", alignItems: "center", borderBottom: `1px solid ${colors.hair}`, padding: "0 12px", minHeight: 44 },
  paperRowSplit: { display: "flex" },
  paperLabel: { fontSize: 11, fontWeight: 700, color: colors.muted, letterSpacing: 1, minWidth: 90, paddingRight: 10 },
  paperInput: { flex: 1, background: "transparent", border: "none", padding: "10px 0", fontSize: 15, fontFamily: fonts.body, color: colors.ink, width: "100%" },
  paperTextarea: { flex: 1, background: "transparent", border: "none", padding: "10px 0", fontSize: 14, fontFamily: fonts.body, color: colors.ink, width: "100%", resize: "vertical", minHeight: 44 },
  requiredMark: { color: colors.navy },

  childBlock: {
    marginBottom: 16,
    paddingBottom: 4,
  },
  childHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: 8,
  },
  childHeaderLabel: {
    fontSize: 11, letterSpacing: 2, color: colors.navy, fontWeight: 700,
  },

  tellMeGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 },
  tellMeBtn: {
    display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
    background: colors.paperFillLight, border: `1px solid ${colors.hair}`, borderRadius: 3,
    cursor: "pointer", fontSize: 14, fontWeight: 700, letterSpacing: 1,
    color: colors.body, fontFamily: fonts.body, textAlign: "left",
  },
  tellMeBtnActive: { background: colors.navySoft, borderColor: colors.navy, color: colors.navy },
  tellMeCheck: {
    width: 20, height: 20, background: colors.paperFill, border: `1.5px solid ${colors.hairDark}`,
    borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 13, color: "transparent", flexShrink: 0,
  },
  tellMeCheckActive: { background: colors.navy, borderColor: colors.navy, color: "#fff" },

  intakeOnly: { marginTop: 28, paddingTop: 20, borderTop: `2px dashed ${colors.hair}` },
  intakeOnlyLabel: { fontSize: 10, letterSpacing: 3, color: colors.subtle, fontWeight: 700, marginBottom: 12 },

  consentBox: { background: colors.navyTint, border: `1px solid ${colors.navySoft}`, borderRadius: 3, padding: 14, marginTop: 20, marginBottom: 16, fontSize: 13, color: colors.body },
  checkbox: { width: 18, height: 18, accentColor: colors.navy, cursor: "pointer", flexShrink: 0 },
  checkboxRow: { display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", fontSize: 14 },
  errorText: { fontSize: 12, color: colors.danger, marginTop: 2, fontWeight: 600 },

  actions: { display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 24, flexWrap: "wrap" },
  btnPrimary: { background: colors.navy, color: colors.paper, border: "none", padding: "13px 24px", fontSize: 14, fontWeight: 700, fontFamily: fonts.body, cursor: "pointer", borderRadius: 3, letterSpacing: 0.3 },
  btnGhost: { background: "transparent", color: colors.body, border: `1px solid ${colors.hairDark}`, padding: "12px 20px", fontSize: 14, fontWeight: 600, fontFamily: fonts.body, cursor: "pointer", borderRadius: 3 },
  btnSm: { background: "transparent", color: colors.body, border: `1px solid ${colors.hairDark}`, padding: "6px 12px", fontSize: 12, fontWeight: 600, fontFamily: fonts.body, cursor: "pointer", borderRadius: 3 },
  btnSmGhost: { background: "transparent", color: colors.muted, border: "none", padding: "6px 12px", fontSize: 12, fontWeight: 600, fontFamily: fonts.body, cursor: "pointer", borderRadius: 3 },
  btnSmDanger: { background: colors.danger, color: "#fff", border: "none", padding: "6px 12px", fontSize: 12, fontWeight: 600, fontFamily: fonts.body, cursor: "pointer", borderRadius: 3 },

  savedToast: { background: colors.success, color: "#fff", padding: "10px 14px", borderRadius: 3, fontSize: 14, marginTop: 16, fontWeight: 500, animation: "slideDown 0.3s ease" },

  summaryBar: { display: "flex", flexWrap: "wrap", gap: 0, marginBottom: 24, background: colors.card, border: `1px solid ${colors.hair}`, borderRadius: 4, padding: 4 },
  summaryItem: { display: "flex", alignItems: "baseline", gap: 8, padding: "10px 16px", borderRight: `1px solid ${colors.hair}` },
  summaryCount: { fontFamily: fonts.display, fontSize: 22, fontWeight: 700, color: colors.navy },
  summaryLabel: { fontSize: 12, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 },

  entryList: { display: "flex", flexDirection: "column", gap: 12 },
  entryCard: { background: colors.card, border: `1px solid ${colors.hair}`, borderRadius: 4, padding: "16px 18px", animation: "fadeIn 0.3s ease" },
  entryHeader: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 },
  entryName: { fontFamily: fonts.display, fontSize: 18, fontWeight: 700, color: colors.ink },
  entryTime: { fontSize: 12, color: colors.subtle, fontWeight: 600 },
  entryDetails: { display: "flex", gap: 12, flexWrap: "wrap", fontSize: 14, color: colors.body, marginBottom: 6, alignItems: "center" },
  entryDetail: { color: colors.muted },
  entryTag: { background: colors.navySoft, color: colors.navy, padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700, letterSpacing: 0.3 },
  entryTagSecondary: { background: colors.paperFillLight, color: colors.body, border: `1px solid ${colors.hair}`, padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, letterSpacing: 0.3 },
  entryMeta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  childrenList: { marginTop: 10, paddingLeft: 12, borderLeft: `2px solid ${colors.navySoft}` },
  childSummary: { fontSize: 13, marginBottom: 8, color: colors.body },
  classTag: { color: colors.navy, fontWeight: 600 },
  allergyFlag: { fontSize: 12, color: colors.warning, fontWeight: 600, marginTop: 2 },
  tagRow: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 },
  entryNotes: { fontSize: 13, color: colors.muted, background: colors.paper, padding: "8px 12px", borderRadius: 3, marginTop: 8, marginBottom: 8, lineHeight: 1.5 },
  entryActions: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 },

  confirmBox: { background: colors.card, border: `1px solid ${colors.hair}`, borderRadius: 4, padding: 0, marginBottom: 16 },
  confirmRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 22px", borderBottom: `1px solid ${colors.hair}` },
  confirmLabel: { fontSize: 12, color: colors.muted, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 },
  confirmValue: { fontFamily: fonts.display, fontSize: 18, fontWeight: 600, color: colors.ink },

  successBlock: { textAlign: "center", padding: "20px 0 32px" },
  successCheck: { fontSize: 36, width: 64, height: 64, borderRadius: "50%", background: colors.success, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontWeight: 700 },
  successEyebrow: { fontSize: 10, letterSpacing: 4, color: colors.success, fontWeight: 700, marginBottom: 12 },
  code: { background: colors.navySoft, color: colors.navy, padding: "2px 8px", borderRadius: 3, fontSize: 14, fontFamily: "monospace" },
  codeInline: { background: colors.navyTint, color: colors.navy, padding: "1px 6px", borderRadius: 3, fontSize: 13, fontFamily: "monospace" },

  groupCard: { background: colors.card, border: `1px solid ${colors.hair}`, borderLeft: `3px solid ${colors.navy}`, borderRadius: 4, padding: "14px 18px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 },
  groupCardLeft: { flex: 1, minWidth: 0 },
  groupCardLabel: { fontSize: 10, letterSpacing: 3, color: colors.navy, fontWeight: 700, marginBottom: 4 },
  groupCardName: { fontFamily: "monospace", fontSize: 18, fontWeight: 700, color: colors.ink, letterSpacing: 0.3, marginBottom: 4 },
  groupCardInput: { fontFamily: "monospace", fontSize: 18, fontWeight: 700, color: colors.ink, background: "transparent", border: "none", borderBottom: `2px solid ${colors.navy}`, padding: "2px 0", marginBottom: 4, width: "100%", outline: "none" },
  groupCardHint: { fontSize: 12, color: colors.muted, lineHeight: 1.4 },
  groupCardCode: { fontFamily: "monospace", fontSize: 12, background: colors.paperFillLight, padding: "1px 5px", borderRadius: 2 },

  fileGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginTop: 24, textAlign: "left" },
  fileCard: { background: colors.card, border: `1px solid ${colors.hair}`, borderRadius: 4, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 },
  fileCardLabel: { fontSize: 10, letterSpacing: 3, color: colors.navy, fontWeight: 700 },
  fileCardName: { fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: colors.ink, wordBreak: "break-all" },
  fileCardHint: { fontSize: 12, color: colors.muted, lineHeight: 1.5, marginBottom: 4 },
  fileCardActions: { display: "flex", gap: 8, marginTop: 4 },

  nextSteps: { background: colors.card, border: `1px solid ${colors.hair}`, borderRadius: 4, padding: "20px 24px", marginTop: 28, textAlign: "left" },
  nextStepsTitle: { fontSize: 11, letterSpacing: 4, color: colors.navy, fontWeight: 700, marginBottom: 12 },
  nextStepsList: { margin: 0, paddingLeft: 22, fontSize: 14, color: colors.body, lineHeight: 1.7 },

  historySection: { marginTop: 40, paddingTop: 24, borderTop: `1px solid ${colors.hair}` },
  historyTitle: { fontSize: 11, letterSpacing: 4, color: colors.subtle, fontWeight: 700, marginBottom: 14 },
  historyRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${colors.hair}` },
  historyDate: { fontFamily: fonts.display, fontSize: 16, fontWeight: 600, color: colors.ink },
  historyMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
};
