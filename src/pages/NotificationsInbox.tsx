import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  ArrowLeft,
  AlertTriangle,
  FileText,
  CheckCircle,
  Truck,
  Settings,
  Trash2,
  CheckCheck,
  Filter,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { supabase } from "../lib/supabase";

interface Notification {
  id: string;
  load_id: string | null;
  driver_id: string | null;
  type: "ISSUE" | "POD_RECEIVED" | "LOAD_DELIVERED" | "STATUS_UPDATE" | "LOAD_ASSIGNED";
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  meta: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

type FilterType = "all" | "unread" | "issues" | "deliveries" | "pods";

export default function NotificationsInbox() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Fetch notifications
  const fetchNotifications = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("dispatch_notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      const { data, error } = await query;
      if (error) throw error;
      setNotifications(data || []);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel("notifications_inbox")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dispatch_notifications",
        },
        (payload) => {
          const newNotification = payload.new as Notification;
          setNotifications((prev) => [newNotification, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Filter notifications
  const filteredNotifications = notifications.filter((n) => {
    switch (filter) {
      case "unread":
        return !n.read_at;
      case "issues":
        return n.type === "ISSUE";
      case "deliveries":
        return n.type === "LOAD_DELIVERED";
      case "pods":
        return n.type === "POD_RECEIVED";
      default:
        return true;
    }
  });

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  // Mark as read
  const markAsRead = async (ids: string[]) => {
    try {
      await supabase
        .from("dispatch_notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);

      setNotifications((prev) =>
        prev.map((n) =>
          ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n
        )
      );
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Failed to mark as read:", err);
    }
  };

  // Mark all as read
  const markAllAsRead = async () => {
    const unreadIds = notifications.filter((n) => !n.read_at).map((n) => n.id);
    if (unreadIds.length > 0) {
      await markAsRead(unreadIds);
    }
  };

  // Delete notifications
  const deleteNotifications = async (ids: string[]) => {
    try {
      await supabase.from("dispatch_notifications").delete().in("id", ids);
      setNotifications((prev) => prev.filter((n) => !ids.includes(n.id)));
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Failed to delete notifications:", err);
    }
  };

  // Toggle selection
  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  // Select all visible
  const selectAll = () => {
    if (selectedIds.size === filteredNotifications.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredNotifications.map((n) => n.id)));
    }
  };

  // Get icon for notification type
  const getIcon = (type: string, severity: string) => {
    if (severity === "critical" || type === "ISSUE") {
      return <AlertTriangle className="h-5 w-5 text-red-500" />;
    }
    if (type === "POD_RECEIVED") {
      return <FileText className="h-5 w-5 text-blue-500" />;
    }
    if (type === "LOAD_DELIVERED") {
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    }
    return <Truck className="h-5 w-5 text-gray-500" />;
  };

  // Format time
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Get severity badge
  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "critical":
        return (
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
            Critical
          </span>
        );
      case "warning":
        return (
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
            Warning
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Back Button */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-base)] transition"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back</span>
      </button>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Bell className="w-6 h-6 text-amber-500" /> Notifications
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up!"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchNotifications}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
            title="Refresh"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => navigate("/settings/notifications")}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
            title="Notification Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-gray-400" />
        {(["all", "unread", "issues", "deliveries", "pods"] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded-lg transition ${
              filter === f
                ? "bg-amber-500 text-black"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {f === "all" && "All"}
            {f === "unread" && `Unread (${unreadCount})`}
            {f === "issues" && "Issues"}
            {f === "deliveries" && "Deliveries"}
            {f === "pods" && "PODs"}
          </button>
        ))}
      </div>

      {/* Bulk Actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <span className="text-sm text-blue-700">
            {selectedIds.size} selected
          </span>
          <button
            onClick={() => markAsRead(Array.from(selectedIds))}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
          >
            <CheckCheck className="w-4 h-4" />
            Mark Read
          </button>
          <button
            onClick={() => deleteNotifications(Array.from(selectedIds))}
            className="flex items-center gap-1 text-sm text-red-600 hover:text-red-800"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-gray-500 hover:text-gray-700 ml-auto"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Quick Actions */}
      {selectedIds.size === 0 && unreadCount > 0 && (
        <div className="flex justify-end">
          <button
            onClick={markAllAsRead}
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            <CheckCheck className="w-4 h-4" />
            Mark all as read
          </button>
        </div>
      )}

      {/* Notifications List */}
      <div className="bg-[var(--bg-card)] rounded-2xl border overflow-hidden">
        {loading && notifications.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin text-gray-300" />
            Loading notifications...
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Bell className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <p className="font-medium">No notifications</p>
            <p className="text-sm mt-1">
              {filter === "all"
                ? "You're all caught up!"
                : "No notifications match this filter"}
            </p>
          </div>
        ) : (
          <>
            {/* Select All Header */}
            <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b text-sm text-gray-500">
              <input
                type="checkbox"
                checked={selectedIds.size === filteredNotifications.length && filteredNotifications.length > 0}
                onChange={selectAll}
                className="w-4 h-4 accent-amber-500"
              />
              <span>Select all</span>
            </div>

            {/* Notification Items */}
            {filteredNotifications.map((notification) => (
              <div
                key={notification.id}
                className={`flex items-start gap-3 p-4 border-b last:border-b-0 transition-colors ${
                  notification.read_at
                    ? "bg-white hover:bg-gray-50"
                    : "bg-amber-50 hover:bg-amber-100"
                } ${notification.severity === "critical" ? "border-l-4 border-l-red-500" : ""}`}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={selectedIds.has(notification.id)}
                  onChange={() => toggleSelect(notification.id)}
                  className="w-4 h-4 mt-1 accent-amber-500"
                />

                {/* Icon */}
                <div className="flex-shrink-0 mt-0.5">
                  {getIcon(notification.type, notification.severity)}
                </div>

                {/* Content */}
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => {
                    markAsRead([notification.id]);
                    if (notification.load_id) {
                      navigate(`/loads/${notification.load_id}`);
                    }
                  }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <p
                      className={`font-medium ${
                        notification.read_at ? "text-gray-700" : "text-gray-900"
                      }`}
                    >
                      {notification.title}
                    </p>
                    {getSeverityBadge(notification.severity)}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {notification.message}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                    <span>{formatTime(notification.created_at)}</span>
                    {notification.meta?.load_reference && (
                      <span className="px-2 py-0.5 bg-gray-100 rounded">
                        Load #{notification.meta.load_reference as string}
                      </span>
                    )}
                    {notification.meta?.driver_name && (
                      <span>Driver: {notification.meta.driver_name as string}</span>
                    )}
                  </div>
                </div>

                {/* View Load Link */}
                {notification.load_id && (
                  <button
                    onClick={() => navigate(`/loads/${notification.load_id}`)}
                    className="p-2 text-gray-400 hover:text-amber-500 hover:bg-gray-100 rounded-lg transition"
                    title="View Load"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}