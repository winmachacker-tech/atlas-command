// FILE: src/components/settings/WhatsAppContactsManager.tsx
//
// WhatsApp Contacts Management Component for Atlas Command
//
// Features:
//   - List all WhatsApp contacts for the org
//   - Add new contacts (internal users, drivers, external)
//   - Edit existing contacts
//   - Toggle Dipsy access per contact
//   - Delete contacts
//   - Link contacts to existing drivers or users
//
// Uses existing Supabase client with RLS - all queries automatically scoped to org
// ============================================================================

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
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
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface WhatsAppContact {
  id: string;
  org_id: string;
  phone_number: string;
  user_id: string | null;
  display_name: string;
  contact_type: 'internal' | 'driver' | 'broker' | 'customer' | 'other';
  driver_id: string | null;
  dipsy_enabled: boolean;
  created_at: string;
  updated_at: string;
  // Joined data
  user_email?: string;
  driver_name?: string;
}

interface Driver {
  id: string;
  name: string;
  phone: string | null;
  status: string;
}

interface OrgUser {
  user_id: string;
  email: string;
  full_name: string | null;
}

type ContactType = WhatsAppContact['contact_type'];

const CONTACT_TYPE_OPTIONS: { value: ContactType; label: string; icon: React.ReactNode }[] = [
  { value: 'internal', label: 'Internal User', icon: <User className="w-4 h-4" /> },
  { value: 'driver', label: 'Driver', icon: <Truck className="w-4 h-4" /> },
  { value: 'broker', label: 'Broker', icon: <Building2 className="w-4 h-4" /> },
  { value: 'customer', label: 'Customer', icon: <Users className="w-4 h-4" /> },
  { value: 'other', label: 'Other', icon: <Phone className="w-4 h-4" /> },
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function WhatsAppContactsManager() {
  // State
  const [contacts, setContacts] = useState<WhatsAppContact[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<WhatsAppContact | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    phone_number: '',
    display_name: '',
    contact_type: 'internal' as ContactType,
    user_id: '',
    driver_id: '',
    dipsy_enabled: true,
  });

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    setError(null);

    try {
      // Fetch contacts
      const { data: contactsData, error: contactsError } = await supabase
        .from('whatsapp_contacts')
        .select('*')
        .order('display_name');

      if (contactsError) throw contactsError;

      // Fetch drivers for linking
      const { data: driversData, error: driversError } = await supabase
        .from('drivers')
        .select('id, name, phone, status')
        .eq('status', 'ACTIVE')
        .order('name');

      if (driversError) throw driversError;

      // Fetch org users for linking
      const { data: usersData, error: usersError } = await supabase
        .from('user_orgs')
        .select(`
          user_id,
          profiles:user_id (
            email,
            full_name
          )
        `);

      if (usersError) throw usersError;

      // Transform users data
      const transformedUsers: OrgUser[] = (usersData || []).map((u: any) => ({
        user_id: u.user_id,
        email: u.profiles?.email || 'Unknown',
        full_name: u.profiles?.full_name || null,
      }));

      setContacts(contactsData || []);
      setDrivers(driversData || []);
      setOrgUsers(transformedUsers);
    } catch (err) {
      console.error('Error fetching WhatsApp data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }

  // ============================================================================
  // HANDLERS
  // ============================================================================

  function openAddModal() {
    setEditingContact(null);
    setFormData({
      phone_number: '',
      display_name: '',
      contact_type: 'internal',
      user_id: '',
      driver_id: '',
      dipsy_enabled: true,
    });
    setIsModalOpen(true);
  }

  function openEditModal(contact: WhatsAppContact) {
    setEditingContact(contact);
    setFormData({
      phone_number: contact.phone_number,
      display_name: contact.display_name,
      contact_type: contact.contact_type,
      user_id: contact.user_id || '',
      driver_id: contact.driver_id || '',
      dipsy_enabled: contact.dipsy_enabled,
    });
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingContact(null);
  }

  function formatPhoneNumber(value: string): string {
    // Strip non-numeric except +
    const cleaned = value.replace(/[^\d+]/g, '');
    
    // Ensure it starts with +
    if (cleaned && !cleaned.startsWith('+')) {
      return '+' + cleaned;
    }
    return cleaned;
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    try {
      const phoneFormatted = formatPhoneNumber(formData.phone_number);

      if (!phoneFormatted || phoneFormatted.length < 10) {
        throw new Error('Please enter a valid phone number in E.164 format (e.g., +15551234567)');
      }

      if (!formData.display_name.trim()) {
        throw new Error('Display name is required');
      }

      const payload = {
        phone_number: phoneFormatted,
        display_name: formData.display_name.trim(),
        contact_type: formData.contact_type,
        user_id: formData.user_id || null,
        driver_id: formData.driver_id || null,
        dipsy_enabled: formData.dipsy_enabled,
      };

      if (editingContact) {
        // Update existing
        const { error: updateError } = await supabase
          .from('whatsapp_contacts')
          .update(payload)
          .eq('id', editingContact.id);

        if (updateError) throw updateError;
      } else {
        // Insert new
        const { error: insertError } = await supabase
          .from('whatsapp_contacts')
          .insert(payload);

        if (insertError) {
          if (insertError.code === '23505') {
            throw new Error('A contact with this phone number already exists');
          }
          throw insertError;
        }
      }

      closeModal();
      fetchData();
    } catch (err) {
      console.error('Error saving contact:', err);
      setError(err instanceof Error ? err.message : 'Failed to save contact');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(contact: WhatsAppContact) {
    if (!confirm(`Delete WhatsApp contact "${contact.display_name}"? This cannot be undone.`)) {
      return;
    }

    try {
      const { error: deleteError } = await supabase
        .from('whatsapp_contacts')
        .delete()
        .eq('id', contact.id);

      if (deleteError) throw deleteError;

      fetchData();
    } catch (err) {
      console.error('Error deleting contact:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete contact');
    }
  }

  async function toggleDipsy(contact: WhatsAppContact) {
    try {
      const { error: updateError } = await supabase
        .from('whatsapp_contacts')
        .update({ dipsy_enabled: !contact.dipsy_enabled })
        .eq('id', contact.id);

      if (updateError) throw updateError;

      // Update local state immediately
      setContacts(prev =>
        prev.map(c =>
          c.id === contact.id ? { ...c, dipsy_enabled: !c.dipsy_enabled } : c
        )
      );
    } catch (err) {
      console.error('Error toggling Dipsy:', err);
      setError(err instanceof Error ? err.message : 'Failed to update contact');
    }
  }

  // Auto-fill from driver selection
  function handleDriverSelect(driverId: string) {
    setFormData(prev => ({ ...prev, driver_id: driverId }));

    if (driverId) {
      const driver = drivers.find(d => d.id === driverId);
      if (driver) {
        setFormData(prev => ({
          ...prev,
          display_name: prev.display_name || driver.name,
          phone_number: prev.phone_number || driver.phone || '',
          contact_type: 'driver',
        }));
      }
    }
  }

  // Auto-fill from user selection
  function handleUserSelect(userId: string) {
    setFormData(prev => ({ ...prev, user_id: userId }));

    if (userId) {
      const user = orgUsers.find(u => u.user_id === userId);
      if (user) {
        setFormData(prev => ({
          ...prev,
          display_name: prev.display_name || user.full_name || user.email.split('@')[0],
          contact_type: 'internal',
        }));
      }
    }
  }

  // ============================================================================
  // FILTERED CONTACTS
  // ============================================================================

  const filteredContacts = contacts.filter(contact => {
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
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-600">Loading WhatsApp contacts...</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <MessageSquare className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">WhatsApp Contacts</h2>
              <p className="text-sm text-gray-500">
                Manage contacts that can message Dipsy via WhatsApp
              </p>
            </div>
          </div>
          <button
            onClick={openAddModal}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Contact
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <span className="text-red-700 text-sm">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-500 hover:text-red-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search */}
      <div className="px-6 py-3 border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Contacts List */}
      <div className="divide-y divide-gray-100">
        {filteredContacts.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            {contacts.length === 0 ? (
              <>
                <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>No WhatsApp contacts yet</p>
                <p className="text-sm mt-1">Add contacts to enable WhatsApp messaging with Dipsy</p>
              </>
            ) : (
              <p>No contacts match your search</p>
            )}
          </div>
        ) : (
          filteredContacts.map(contact => (
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

      {/* Contact Count */}
      {contacts.length > 0 && (
        <div className="px-6 py-3 bg-gray-50 text-sm text-gray-500 rounded-b-lg">
          {filteredContacts.length} of {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
        </div>
      )}

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
          error={error}
        />
      )}
    </div>
  );
}

// ============================================================================
// CONTACT ROW COMPONENT
// ============================================================================

interface ContactRowProps {
  contact: WhatsAppContact;
  onEdit: () => void;
  onDelete: () => void;
  onToggleDipsy: () => void;
}

function ContactRow({ contact, onEdit, onDelete, onToggleDipsy }: ContactRowProps) {
  const typeConfig = CONTACT_TYPE_OPTIONS.find(t => t.value === contact.contact_type);

  return (
    <div className="px-6 py-4 hover:bg-gray-50 transition-colors">
      <div className="flex items-center justify-between">
        {/* Contact Info */}
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
            {typeConfig?.icon || <User className="w-5 h-5 text-gray-500" />}
          </div>
          <div>
            <div className="font-medium text-gray-900">{contact.display_name}</div>
            <div className="text-sm text-gray-500 flex items-center gap-2">
              <Phone className="w-3 h-3" />
              {contact.phone_number}
            </div>
          </div>
        </div>

        {/* Type Badge */}
        <div className="flex items-center gap-4">
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600 capitalize">
            {contact.contact_type}
          </span>

          {/* Dipsy Toggle */}
          <button
            onClick={onToggleDipsy}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              contact.dipsy_enabled
                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
            title={contact.dipsy_enabled ? 'Dipsy enabled - click to disable' : 'Dipsy disabled - click to enable'}
          >
            <Bot className="w-4 h-4" />
            {contact.dipsy_enabled ? 'Dipsy On' : 'Dipsy Off'}
          </button>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <button
              onClick={onEdit}
              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              title="Edit contact"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={onDelete}
              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Delete contact"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MODAL COMPONENT
// ============================================================================

interface ContactModalProps {
  isEditing: boolean;
  formData: {
    phone_number: string;
    display_name: string;
    contact_type: ContactType;
    user_id: string;
    driver_id: string;
    dipsy_enabled: boolean;
  };
  setFormData: React.Dispatch<React.SetStateAction<typeof formData>>;
  drivers: Driver[];
  orgUsers: OrgUser[];
  onDriverSelect: (id: string) => void;
  onUserSelect: (id: string) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  error: string | null;
}

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
  error,
}: ContactModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">
            {isEditing ? 'Edit Contact' : 'Add WhatsApp Contact'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Error in modal */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Phone Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone Number <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              placeholder="+15551234567"
              value={formData.phone_number}
              onChange={e => setFormData(prev => ({ ...prev, phone_number: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500">E.164 format with country code</p>
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Display Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="John Smith"
              value={formData.display_name}
              onChange={e => setFormData(prev => ({ ...prev, display_name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>

          {/* Contact Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Contact Type
            </label>
            <select
              value={formData.contact_type}
              onChange={e => setFormData(prev => ({ ...prev, contact_type: e.target.value as ContactType }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            >
              {CONTACT_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Link to Atlas User */}
          {formData.contact_type === 'internal' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Link to Atlas User
              </label>
              <select
                value={formData.user_id}
                onChange={e => onUserSelect(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              >
                <option value="">-- Select User (Optional) --</option>
                {orgUsers.map(user => (
                  <option key={user.user_id} value={user.user_id}>
                    {user.full_name || user.email}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Link to Driver */}
          {formData.contact_type === 'driver' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Link to Driver
              </label>
              <select
                value={formData.driver_id}
                onChange={e => onDriverSelect(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              >
                <option value="">-- Select Driver (Optional) --</option>
                {drivers.map(driver => (
                  <option key={driver.id} value={driver.id}>
                    {driver.name} {driver.phone ? `(${driver.phone})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Dipsy Toggle */}
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-green-600" />
              <div>
                <div className="font-medium text-gray-900">Dipsy Access</div>
                <div className="text-xs text-gray-500">Allow this contact to interact with Dipsy</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFormData(prev => ({ ...prev, dipsy_enabled: !prev.dipsy_enabled }))}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                formData.dipsy_enabled ? 'bg-green-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  formData.dipsy_enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                {isEditing ? 'Update' : 'Add Contact'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}