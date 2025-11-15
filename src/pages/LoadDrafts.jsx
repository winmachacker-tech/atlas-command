import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import DocumentUpload from '../components/DocumentUpload';

export default function LoadDrafts() {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [userId, setUserId] = useState(null);

  // Get current user
  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
      }
    }
    loadUser();
  }, []);

  useEffect(() => {
    if (!userId) return;

    fetchDrafts();

    // Realtime subscription for new drafts
    const subscription = supabase
      .channel('load_drafts_changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'load_drafts',
        },
        (payload) => {
          console.log('New draft received:', payload.new);
          setDrafts((prev) => [payload.new, ...prev]);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'load_drafts',
        },
        (payload) => {
          console.log('Draft updated:', payload.new);
          setDrafts((prev) =>
            prev.map((draft) => (draft.id === payload.new.id ? payload.new : draft))
          );
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [userId]);

  const fetchDrafts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('load_drafts')
      .select('*')
      .in('status', ['pending_review', 'edited'])
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching drafts:', error);
    } else {
      setDrafts(data || []);
    }
    setLoading(false);
  };

  const approveLoad = async (draft) => {
    try {
      const data = draft.extracted_data;

      // Create the load - use same structure as your AddLoadModal
      const { data: newLoad, error: loadError } = await supabase
        .from('loads')
        .insert({
          created_by: userId,
          org_id: draft.organization_id, // Carry over the org_id from draft
          origin: data.pickup_location,
          destination: data.delivery_location,
          pickup_date: data.pickup_date,
          pickup_time: data.pickup_time,
          delivery_date: data.delivery_date,
          delivery_time: data.delivery_time,
          commodity: data.commodity,
          weight: data.weight,
          rate: data.rate,
          customer: data.customer_name,
          reference: data.reference_numbers?.bol || data.reference_numbers?.load,
          po_number: data.reference_numbers?.po,
          status: 'AVAILABLE',
          notes: data.notes,
        })
        .select()
        .single();

      if (loadError) throw loadError;

      // Update draft status
      const { error: updateError } = await supabase
        .from('load_drafts')
        .update({
          status: 'approved',
          load_id: newLoad.id,
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', draft.id);

      if (updateError) throw updateError;

      console.log('Load created:', newLoad);
      
      // Navigate to loads page
      navigate('/loads');
    } catch (error) {
      console.error('Error approving load:', error);
      alert('Failed to create load: ' + error.message);
    }
  };

  const rejectDraft = async (draft) => {
    if (!confirm('Are you sure you want to reject this draft?')) return;

    const { error } = await supabase
      .from('load_drafts')
      .update({
        status: 'rejected',
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', draft.id);

    if (error) {
      console.error('Error rejecting draft:', error);
    }
  };

  const editDraft = (draft) => {
    setSelectedDraft(draft);
  };

  const saveEdit = async () => {
    const { error } = await supabase
      .from('load_drafts')
      .update({
        extracted_data: selectedDraft.extracted_data,
        status: 'edited',
      })
      .eq('id', selectedDraft.id);

    if (error) {
      console.error('Error saving edit:', error);
    } else {
      setSelectedDraft(null);
    }
  };

  const getConfidenceColor = (score) => {
    if (score >= 80) return 'bg-green-100 text-green-800';
    if (score >= 60) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Load Drafts</h1>
        <p className="text-[var(--text-muted)]">Review AI-extracted loads before adding to your system</p>
      </div>

      {/* Upload Section */}
      <div className="mb-8">
        <DocumentUpload userId={userId} />
      </div>

      {/* Drafts List */}
      {drafts.length === 0 ? (
        <div className="bg-[var(--bg-panel)] rounded-lg shadow p-8 text-center text-[var(--text-muted)]">
          <p>No pending drafts. Upload a document to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map((draft) => {
            const data = draft.extracted_data;
            return (
              <div key={draft.id} className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg shadow p-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-xl font-bold">
                        {data.pickup_location || 'Unknown'} → {data.delivery_location || 'Unknown'}
                      </h3>
                      <span
                        className={`px-3 py-1 rounded-full text-sm font-medium ${getConfidenceColor(
                          draft.confidence_score
                        )}`}
                      >
                        {draft.confidence_score}% confidence
                      </span>
                    </div>
                    {data.customer_name && (
                      <p className="text-[var(--text-muted)]">Customer: {data.customer_name}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-green-600">
                      ${data.rate?.toLocaleString() || 'N/A'}
                    </p>
                    <p className="text-sm text-[var(--text-muted)]">
                      {new Date(draft.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-[var(--text-muted)]">Pickup</p>
                    <p className="font-medium">
                      {data.pickup_date
                        ? new Date(data.pickup_date).toLocaleDateString()
                        : 'Not specified'}
                    </p>
                    {data.pickup_time && (
                      <p className="text-sm text-[var(--text-muted)]">{data.pickup_time}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-sm text-[var(--text-muted)]">Delivery</p>
                    <p className="font-medium">
                      {data.delivery_date
                        ? new Date(data.delivery_date).toLocaleDateString()
                        : 'Not specified'}
                    </p>
                    {data.delivery_time && (
                      <p className="text-sm text-[var(--text-muted)]">{data.delivery_time}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-sm text-[var(--text-muted)]">Commodity</p>
                    <p className="font-medium">{data.commodity || 'Not specified'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-[var(--text-muted)]">Weight</p>
                    <p className="font-medium">
                      {data.weight ? `${data.weight.toLocaleString()} lbs` : 'Not specified'}
                    </p>
                  </div>
                </div>

                {data.reference_numbers && (
                  <div className="mb-4 text-sm text-[var(--text-muted)]">
                    {data.reference_numbers.bol && <span>BOL: {data.reference_numbers.bol} </span>}
                    {data.reference_numbers.po && <span>PO: {data.reference_numbers.po} </span>}
                    {data.reference_numbers.load && (
                      <span>Load#: {data.reference_numbers.load}</span>
                    )}
                  </div>
                )}

                {data.notes && (
                  <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                    <p className="text-sm font-medium text-yellow-800">AI Notes:</p>
                    <p className="text-sm text-yellow-700">{data.notes}</p>
                  </div>
                )}

                <div className="flex gap-3 pt-4 border-t border-[var(--border)]">
                  <button
                    onClick={() => approveLoad(draft)}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded font-medium transition"
                  >
                    ✓ Approve & Create Load
                  </button>
                  <button
                    onClick={() => editDraft(draft)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded font-medium transition"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => rejectDraft(draft)}
                    className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded font-medium transition"
                  >
                    ✗ Reject
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Modal */}
      {selectedDraft && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--bg-panel)] rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-xl font-bold mb-4">Edit Load Draft</h2>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Pickup Location</label>
                  <input
                    type="text"
                    value={selectedDraft.extracted_data.pickup_location || ''}
                    onChange={(e) =>
                      setSelectedDraft({
                        ...selectedDraft,
                        extracted_data: {
                          ...selectedDraft.extracted_data,
                          pickup_location: e.target.value,
                        },
                      })
                    }
                    className="w-full px-3 py-2 border border-[var(--border)] bg-[var(--bg-surface)] rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Delivery Location</label>
                  <input
                    type="text"
                    value={selectedDraft.extracted_data.delivery_location || ''}
                    onChange={(e) =>
                      setSelectedDraft({
                        ...selectedDraft,
                        extracted_data: {
                          ...selectedDraft.extracted_data,
                          delivery_location: e.target.value,
                        },
                      })
                    }
                    className="w-full px-3 py-2 border border-[var(--border)] bg-[var(--bg-surface)] rounded"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Pickup Date</label>
                  <input
                    type="date"
                    value={selectedDraft.extracted_data.pickup_date || ''}
                    onChange={(e) =>
                      setSelectedDraft({
                        ...selectedDraft,
                        extracted_data: {
                          ...selectedDraft.extracted_data,
                          pickup_date: e.target.value,
                        },
                      })
                    }
                    className="w-full px-3 py-2 border border-[var(--border)] bg-[var(--bg-surface)] rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Delivery Date</label>
                  <input
                    type="date"
                    value={selectedDraft.extracted_data.delivery_date || ''}
                    onChange={(e) =>
                      setSelectedDraft({
                        ...selectedDraft,
                        extracted_data: {
                          ...selectedDraft.extracted_data,
                          delivery_date: e.target.value,
                        },
                      })
                    }
                    className="w-full px-3 py-2 border border-[var(--border)] bg-[var(--bg-surface)] rounded"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Rate ($)</label>
                  <input
                    type="number"
                    value={selectedDraft.extracted_data.rate || ''}
                    onChange={(e) =>
                      setSelectedDraft({
                        ...selectedDraft,
                        extracted_data: {
                          ...selectedDraft.extracted_data,
                          rate: parseFloat(e.target.value),
                        },
                      })
                    }
                    className="w-full px-3 py-2 border border-[var(--border)] bg-[var(--bg-surface)] rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Weight (lbs)</label>
                  <input
                    type="number"
                    value={selectedDraft.extracted_data.weight || ''}
                    onChange={(e) =>
                      setSelectedDraft({
                        ...selectedDraft,
                        extracted_data: {
                          ...selectedDraft.extracted_data,
                          weight: parseFloat(e.target.value),
                        },
                      })
                    }
                    className="w-full px-3 py-2 border border-[var(--border)] bg-[var(--bg-surface)] rounded"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Commodity</label>
                <input
                  type="text"
                  value={selectedDraft.extracted_data.commodity || ''}
                  onChange={(e) =>
                    setSelectedDraft({
                      ...selectedDraft,
                      extracted_data: {
                        ...selectedDraft.extracted_data,
                        commodity: e.target.value,
                      },
                    })
                  }
                  className="w-full px-3 py-2 border border-[var(--border)] bg-[var(--bg-surface)] rounded"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Customer Name</label>
                <input
                  type="text"
                  value={selectedDraft.extracted_data.customer_name || ''}
                  onChange={(e) =>
                    setSelectedDraft({
                      ...selectedDraft,
                      extracted_data: {
                        ...selectedDraft.extracted_data,
                        customer_name: e.target.value,
                      },
                    })
                  }
                  className="w-full px-3 py-2 border border-[var(--border)] bg-[var(--bg-surface)] rounded"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={saveEdit}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded font-medium"
              >
                Save Changes
              </button>
              <button
                onClick={() => setSelectedDraft(null)}
                className="bg-gray-300 hover:bg-gray-400 px-6 py-2 rounded font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}