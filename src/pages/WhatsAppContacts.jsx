// FILE: src/pages/WhatsAppContacts.jsx
//
// WhatsApp Contacts Management Page for Atlas Command
// Standalone page at /settings/whatsapp
//
// Features:
//   - List all WhatsApp contacts for the org
//   - Add new contacts (internal users, drivers, external)
//   - Edit existing contacts
//   - Toggle Dipsy access per contact
//   - Delete contacts
//   - Link contacts to existing drivers or users

import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  MessageSquare,
  Plus,
  Pencil,
  Trash2,
  Phone,
  User,
  Truck,
  Building2,
  Users,
  Bot,
  Check,
  X,
  Loader2,
  AlertCircle,
  Search,
  CheckCircle2,
  ArrowLeft,
  Send,
} from "lucide-react";
import { Link } from "react-router-dom";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

const CONTACT_TYPE_OPTIONS = [
  { value: "internal", label: "Internal User", icon: User },
  { value: "driver", label: "Driver", icon: Truck },
  { value: "broker", label: "Broker", icon: Building2 },
  { value: "customer", label: "Customer", icon: Users },
  { value: "other", label: "Other", icon: Phone },
];

// ============================================================================
// INLINE ALERT (matches Settings.jsx style)
// ============================================================================

function InlineAlert({ kind = "info", children, onClose }) {
  const scheme =
    kind === "success"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
      : kind === "error"
      ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
      : "border-sky-500/40 bg-sky-500/10 text-sky-200";
  return (
    <div className={cx("rounded-xl border px-3 py-2 text-sm", scheme)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {kind === "success" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <span>{children}</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="hover:opacity-70">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// CARD (matches Settings.jsx style)
// ============================================================================

function Card({ icon: Icon, title, subtitle, children, actions }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#12151b] p-6 shadow-sm">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {Icon ? (
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/5">
              <Icon className="h-5 w-5 text-green-400" />
            </div>
          ) : null}
          <div>
            <div className="text-lg font-semibold">{title}</div>
            {subtitle ? (
              <div className="text-sm text-white/60">{subtitle}</div>
            ) : null}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function WhatsAppContacts() {
  // State
  const [contacts, setContacts] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [orgUsers, setOrgUsers] = useState([]);
  const [orgId, setOrgId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    phone_number: "",
    display_name: "",
    contact_type: "internal",
    user_id: "",
    driver_id: "",
    dipsy_enabled: true,
    telegram_chat_id: "",
  });

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // First, get the user's org_id from user_org_memberships
      const { data: orgData, error: orgError } = await supabase
        .from("user_org_memberships")
        .select("org_id")
        .limit(1)
        .single();

      if (orgError) {
        console.error("Error fetching org:", orgError);
        // Fallback: try team_members
        const { data: tmData, error: tmError } = await supabase
          .from("team_members")
          .select("org_id")
          .eq("status", "active")
          .limit(1)
          .single();
        
        if (tmError || !tmData) {
          throw new Error("Could not determine your organization");
        }
        setOrgId(tmData.org_id);
        console.log("[WhatsApp] Using org_id from team_members:", tmData.org_id);
      } else {
        setOrgId(orgData.org_id);
        console.log("[WhatsApp] Using org_id from user_org_memberships:", orgData.org_id);
      }

      // Fetch contacts
      const { data: contactsData, error: contactsError } = await supabase
        .from("whatsapp_contacts")
        .select("*")
        .order("display_name");

      if (contactsError) throw contactsError;

      // Fetch drivers for linking
      const { data: driversData, error: driversError } = await supabase
        .from("drivers")
        .select("id, full_name, first_name, last_name, phone, status")
        .eq("status", "ACTIVE")
        .order("full_name");

      if (driversError) throw driversError;

      // Fetch org users for linking - query user_orgs first, then get profile info
      const { data: userOrgsData, error: userOrgsError } = await supabase
        .from("user_orgs")
        .select("user_id");

      if (userOrgsError) throw userOrgsError;

      // Get profile info for these users from auth or profiles table
      let transformedUsers = [];
      if (userOrgsData && userOrgsData.length > 0) {
        const userIds = userOrgsData.map((u) => u.user_id);
        
        // Try to get profiles - if this fails, we'll just use user_ids
        const { data: profilesData } = await supabase
          .from("profiles")
          .select("id, email, full_name")
          .in("id", userIds);

        if (profilesData) {
          transformedUsers = profilesData.map((p) => ({
            user_id: p.id,
            email: p.email || "Unknown",
            full_name: p.full_name || null,
          }));
        } else {
          // Fallback - just use user_ids without profile info
          transformedUsers = userOrgsData.map((u) => ({
            user_id: u.user_id,
            email: "Unknown",
            full_name: null,
          }));
        }
      }

      setContacts(contactsData || []);
      setDrivers(driversData || []);
      setOrgUsers(transformedUsers);
    } catch (err) {
      console.error("Error fetching WhatsApp data:", err);
      setError(err.message || "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  function openAddModal() {
    setEditingContact(null);
    setFormData({
      phone_number: "",
      display_name: "",
      contact_type: "internal",
      user_id: "",
      driver_id: "",
      dipsy_enabled: true,
      telegram_chat_id: "",
    });
    setIsModalOpen(true);
  }

  function openEditModal(contact) {
    setEditingContact(contact);
    setFormData({
      phone_number: contact.phone_number,
      display_name: contact.display_name,
      contact_type: contact.contact_type,
      user_id: contact.user_id || "",
      driver_id: contact.driver_id || "",
      dipsy_enabled: contact.dipsy_enabled,
      telegram_chat_id: contact.telegram_chat_id || "",
    });
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingContact(null);
  }

  function formatPhoneNumber(value) {
    // Strip non-numeric except +
    const cleaned = value.replace(/[^\d+]/g, "");

    // Ensure it starts with +
    if (cleaned && !cleaned.startsWith("+")) {
      return "+" + cleaned;
    }
    return cleaned;
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    try {
      const phoneFormatted = formatPhoneNumber(formData.phone_number);

      if (!phoneFormatted || phoneFormatted.length < 10) {
        throw new Error(
          "Please enter a valid phone number in E.164 format (e.g., +15551234567)"
        );
      }

      if (!formData.display_name.trim()) {
        throw new Error("Display name is required");
      }

      const payload = {
        org_id: orgId,
        phone_number: phoneFormatted,
        display_name: formData.display_name.trim(),
        contact_type: formData.contact_type,
        user_id: formData.user_id || null,
        driver_id: formData.driver_id || null,
        dipsy_enabled: formData.dipsy_enabled,
        telegram_chat_id: formData.telegram_chat_id.trim() || null,
      };

      console.log("[WhatsApp] Insert payload:", payload);

      if (!orgId) {
        throw new Error("Organization not found. Please refresh the page.");
      }

      if (editingContact) {
        // Update existing
        const { error: updateError } = await supabase
          .from("whatsapp_contacts")
          .update(payload)
          .eq("id", editingContact.id);

        if (updateError) throw updateError;
        setSuccess("Contact updated successfully!");
      } else {
        // Insert new
        const { error: insertError } = await supabase
          .from("whatsapp_contacts")
          .insert(payload);

        if (insertError) {
          if (insertError.code === "23505") {
            throw new Error("A contact with this phone number already exists");
          }
          throw insertError;
        }
        setSuccess("Contact added successfully!");
      }

      closeModal();
      fetchData();

      // Clear success after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error("Error saving contact:", err);
      setError(err.message || "Failed to save contact");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(contact) {
    if (
      !confirm(
        `Delete WhatsApp contact "${contact.display_name}"? This cannot be undone.`
      )
    ) {
      return;
    }

    try {
      const { error: deleteError } = await supabase
        .from("whatsapp_contacts")
        .delete()
        .eq("id", contact.id);

      if (deleteError) throw deleteError;

      setSuccess("Contact deleted successfully!");
      fetchData();

      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error("Error deleting contact:", err);
      setError(err.message || "Failed to delete contact");
    }
  }

  async function toggleDipsy(contact) {
    try {
      const { error: updateError } = await supabase
        .from("whatsapp_contacts")
        .update({ dipsy_enabled: !contact.dipsy_enabled })
        .eq("id", contact.id);

      if (updateError) throw updateError;

      // Update local state immediately
      setContacts((prev) =>
        prev.map((c) =>
          c.id === contact.id ? { ...c, dipsy_enabled: !c.dipsy_enabled } : c
        )
      );
    } catch (err) {
      console.error("Error toggling Dipsy:", err);
      setError(err.message || "Failed to update contact");
    }
  }

  // Auto-fill from driver selection
  function handleDriverSelect(driverId) {
    setFormData((prev) => ({ ...prev, driver_id: driverId }));

    if (driverId) {
      const driver = drivers.find((d) => d.id === driverId);
      if (driver) {
        const driverName = driver.full_name || `${driver.first_name || ''} ${driver.last_name || ''}`.trim();
        setFormData((prev) => ({
          ...prev,
          display_name: prev.display_name || driverName,
          phone_number: prev.phone_number || driver.phone || "",
          contact_type: "driver",
        }));
      }
    }
  }

  // Auto-fill from user selection
  function handleUserSelect(userId) {
    setFormData((prev) => ({ ...prev, user_id: userId }));

    if (userId) {
      const user = orgUsers.find((u) => u.user_id === userId);
      if (user) {
        setFormData((prev) => ({
          ...prev,
          display_name:
            prev.display_name || user.full_name || user.email.split("@")[0],
          contact_type: "internal",
        }));
      }
    }
  }

  // ============================================================================
  // FILTERED CONTACTS
  // ============================================================================

  const filteredContacts = contacts.filter((contact) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      contact.display_name.toLowerCase().includes(query) ||
      contact.phone_number.includes(query) ||
      contact.contact_type.toLowerCase().includes(query)
    );
  });

  // ============================================================================
  // RENDER
  // ============================================================================

  if (loading) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center gap-2 text-white/70">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading WhatsApp contacts…</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Page Header */}
        <div className="rounded-2xl border border-white/10 bg-[#0f1318] p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Link
                to="/profile"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 transition"
              >
                <ArrowLeft className="h-5 w-5 text-white/60" />
              </Link>
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/10">
                <MessageSquare className="h-6 w-6 text-green-400" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold">WhatsApp Contacts</h1>
                <p className="text-sm text-white/60">
                  Manage contacts that can message Dipsy via WhatsApp
                </p>
              </div>
            </div>

            <button
              onClick={openAddModal}
              className={cx(
                "inline-flex items-center gap-2 rounded-xl bg-green-500/90 px-4 py-2 text-sm font-medium text-black transition",
                "hover:bg-green-400"
              )}
            >
              <Plus className="h-4 w-4" />
              Add Contact
            </button>
          </div>

          {/* Alerts */}
          {error && (
            <div className="mt-4">
              <InlineAlert kind="error" onClose={() => setError(null)}>
                {error}
              </InlineAlert>
            </div>
          )}
          {success && (
            <div className="mt-4">
              <InlineAlert kind="success" onClose={() => setSuccess(null)}>
                {success}
              </InlineAlert>
            </div>
          )}
        </div>

        {/* Contacts Card */}
        <Card
          icon={MessageSquare}
          title="Contacts"
          subtitle={`${contacts.length} contact${contacts.length !== 1 ? "s" : ""} configured`}
          actions={
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-white/40" />
              <input
                type="text"
                placeholder="Search contacts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-xl border border-white/10 bg-black/20 text-sm outline-none focus:border-green-500/50"
              />
            </div>
          }
        >
          {/* Contacts List */}
          <div className="space-y-2">
            {filteredContacts.length === 0 ? (
              <div className="py-8 text-center text-white/50">
                {contacts.length === 0 ? (
                  <>
                    <MessageSquare className="h-12 w-12 mx-auto mb-3 text-white/20" />
                    <p>No WhatsApp contacts yet</p>
                    <p className="text-sm mt-1">
                      Add contacts to enable WhatsApp messaging with Dipsy
                    </p>
                  </>
                ) : (
                  <p>No contacts match your search</p>
                )}
              </div>
            ) : (
              filteredContacts.map((contact) => (
                <ContactRow
                  key={contact.id}
                  contact={contact}
                  onEdit={() => openEditModal(contact)}
                  onDelete={() => handleDelete(contact)}
                  onToggleDipsy={() => toggleDipsy(contact)}
                />
              ))
            )}
          </div>
        </Card>

        {/* Help Card */}
        <Card
          icon={Bot}
          title="How Messaging Integration Works"
          subtitle="Connect your team to Dipsy via Telegram or WhatsApp"
        >
          <div className="space-y-3 text-sm text-white/70">
            <p>
              <strong className="text-blue-400">📱 Telegram (Recommended)</strong>
            </p>
            <p>
              <strong className="text-white/90">1.</strong> Have each team member open Telegram and message <code className="bg-white/10 px-1 rounded">@AtlasDipsyBot</code>
            </p>
            <p>
              <strong className="text-white/90">2.</strong> Send <code className="bg-white/10 px-1 rounded">/start</code> to get their Chat ID
            </p>
            <p>
              <strong className="text-white/90">3.</strong> Add that Chat ID to their contact here, then they can chat with Dipsy!
            </p>
            
            <div className="my-4 h-px bg-white/10" />
            
            <p>
              <strong className="text-green-400">💬 WhatsApp</strong>
            </p>
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
              <p className="text-amber-200 text-xs">
                <strong>Note:</strong> WhatsApp Business API requires Meta Business verification. 
                We recommend starting with Telegram for faster setup.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <ContactModal
          isEditing={!!editingContact}
          formData={formData}
          setFormData={setFormData}
          drivers={drivers}
          orgUsers={orgUsers}
          onDriverSelect={handleDriverSelect}
          onUserSelect={handleUserSelect}
          onSave={handleSave}
          onClose={closeModal}
          saving={saving}
        />
      )}
    </div>
  );
}

// ============================================================================
// CONTACT ROW COMPONENT
// ============================================================================

function ContactRow({ contact, onEdit, onDelete, onToggleDipsy }) {
  const typeConfig = CONTACT_TYPE_OPTIONS.find(
    (t) => t.value === contact.contact_type
  );
  const TypeIcon = typeConfig?.icon || User;

  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-4 hover:bg-black/30 transition">
      {/* Contact Info */}
      <div className="flex items-center gap-4">
        <div className="h-10 w-10 rounded-full bg-white/5 flex items-center justify-center">
          <TypeIcon className="h-5 w-5 text-white/60" />
        </div>
        <div>
          <div className="font-medium">{contact.display_name}</div>
          <div className="text-sm text-white/50 flex items-center gap-2">
            <Phone className="h-3 w-3" />
            {contact.phone_number}
          </div>
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-4">
        {/* Type Badge */}
        <span className="px-2 py-1 text-xs font-medium rounded-full bg-white/5 text-white/60 capitalize">
          {contact.contact_type}
        </span>

        {/* Telegram Badge */}
        {contact.telegram_chat_id && (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-500/20 text-blue-400 flex items-center gap-1">
            <Send className="h-3 w-3" />
            Telegram
          </span>
        )}

        {/* Dipsy Toggle */}
        <button
          onClick={onToggleDipsy}
          className={cx(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition",
            contact.dipsy_enabled
              ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
              : "bg-white/5 text-white/50 hover:bg-white/10"
          )}
          title={
            contact.dipsy_enabled
              ? "Dipsy enabled - click to disable"
              : "Dipsy disabled - click to enable"
          }
        >
          <Bot className="h-4 w-4" />
          {contact.dipsy_enabled ? "Dipsy On" : "Dipsy Off"}
        </button>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={onEdit}
            className="p-2 text-white/40 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition"
            title="Edit contact"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-2 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
            title="Delete contact"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MODAL COMPONENT
// ============================================================================

function ContactModal({
  isEditing,
  formData,
  setFormData,
  drivers,
  orgUsers,
  onDriverSelect,
  onUserSelect,
  onSave,
  onClose,
  saving,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Modal */}
      <div className="relative rounded-2xl border border-white/10 bg-[#12151b] shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {isEditing ? "Edit Contact" : "Add WhatsApp Contact"}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-white/40 hover:text-white/60 rounded"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Phone Number */}
          <div>
            <label className="block text-xs text-white/70 mb-1">
              Phone Number <span className="text-red-400">*</span>
            </label>
            <input
              type="tel"
              placeholder="+15551234567"
              value={formData.phone_number}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, phone_number: e.target.value }))
              }
              className="w-full px-3 py-2 rounded-lg border border-white/10 bg-black/20 text-sm outline-none focus:border-green-500/50"
            />
            <p className="mt-1 text-xs text-white/50">
              E.164 format with country code
            </p>
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-xs text-white/70 mb-1">
              Display Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              placeholder="John Smith"
              value={formData.display_name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, display_name: e.target.value }))
              }
              className="w-full px-3 py-2 rounded-lg border border-white/10 bg-black/20 text-sm outline-none focus:border-green-500/50"
            />
          </div>

          {/* Contact Type */}
          <div>
            <label className="block text-xs text-white/70 mb-1">
              Contact Type
            </label>
            <select
              value={formData.contact_type}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, contact_type: e.target.value }))
              }
              className="w-full px-3 py-2 rounded-lg border border-white/10 bg-black/20 text-sm outline-none focus:border-green-500/50"
            >
              {CONTACT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-[#12151b]">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Link to Atlas User */}
          {formData.contact_type === "internal" && (
            <div>
              <label className="block text-xs text-white/70 mb-1">
                Link to Atlas User
              </label>
              <select
                value={formData.user_id}
                onChange={(e) => onUserSelect(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-white/10 bg-black/20 text-sm outline-none focus:border-green-500/50"
              >
                <option value="" className="bg-[#12151b]">
                  -- Select User (Optional) --
                </option>
                {orgUsers.map((user) => (
                  <option
                    key={user.user_id}
                    value={user.user_id}
                    className="bg-[#12151b]"
                  >
                    {user.full_name || user.email}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Link to Driver */}
          {formData.contact_type === "driver" && (
            <div>
              <label className="block text-xs text-white/70 mb-1">
                Link to Driver
              </label>
              <select
                value={formData.driver_id}
                onChange={(e) => onDriverSelect(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-white/10 bg-black/20 text-sm outline-none focus:border-green-500/50"
              >
                <option value="" className="bg-[#12151b]">
                  -- Select Driver (Optional) --
                </option>
                {drivers.map((driver) => {
                  const driverName = driver.full_name || `${driver.first_name || ''} ${driver.last_name || ''}`.trim();
                  return (
                    <option
                      key={driver.id}
                      value={driver.id}
                      className="bg-[#12151b]"
                    >
                      {driverName} {driver.phone ? `(${driver.phone})` : ""}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Telegram Chat ID */}
          <div>
            <label className="block text-xs text-white/70 mb-1">
              Telegram Chat ID
            </label>
            <input
              type="text"
              placeholder="123456789"
              value={formData.telegram_chat_id}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, telegram_chat_id: e.target.value }))
              }
              className="w-full px-3 py-2 rounded-lg border border-white/10 bg-black/20 text-sm outline-none focus:border-blue-500/50"
            />
            <p className="mt-1 text-xs text-white/50">
              User sends /start to @AtlasDipsyBot to get their Chat ID
            </p>
          </div>

          {/* Dipsy Toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-white/10 bg-black/10">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-green-400" />
              <div>
                <div className="font-medium text-sm">Dipsy Access</div>
                <div className="text-xs text-white/50">
                  Allow this contact to interact with Dipsy
                </div>
              </div>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={formData.dipsy_enabled}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    dipsy_enabled: e.target.checked,
                  }))
                }
              />
              <div className="peer h-6 w-11 rounded-full bg-white/10 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-green-500/60 peer-checked:after:translate-x-5" />
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-white/70 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className={cx(
              "flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition",
              saving
                ? "bg-green-500/50 text-black/50 cursor-not-allowed"
                : "bg-green-500/90 text-black hover:bg-green-400"
            )}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                {isEditing ? "Update" : "Add Contact"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}