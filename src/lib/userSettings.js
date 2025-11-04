// src/lib/userSettings.js
import { supabase } from "./supabase";

/**
 * User Settings Data Service (Supabase)
 * ------------------------------------------------------------
 * - Profile fields live in Supabase Auth user metadata.
 * - Avatar upload goes through the Edge Function `profile-avatar`.
 *   Using supabase.functions.invoke so the SDK injects Authorization
 *   and apikey headers automatically (removes 401 issues).
 */

const AVATAR_BUCKET = "profiles";
const AVATAR_FILENAME = "avatar";

/* --------------------------------- Helpers -------------------------------- */

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/** Signed URL helper for private storage files (still used for initial load) */
async function getSignedUrl(path, expiresIn = 60 * 60) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Get current auth user (throws if none) */
export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  assert(data?.user, "Not authenticated");
  return data.user;
}

/* --------------------------------- Profile -------------------------------- */

/**
 * getProfile()
 * Returns normalized profile from Auth metadata (safe, no DB table required).
 */
export async function getProfile() {
  const user = await getCurrentUser();
  const m = user.user_metadata || {};
  const profile = {
    id: user.id,
    email: user.email ?? "",
    fullName: m.fullName ?? m.full_name ?? "",
    phone: m.phone ?? "",
    company: m.company ?? "",
    title: m.title ?? "",
    timezone: m.timezone ?? "America/Los_Angeles",
    avatar_path: m.avatar_path ?? "",
    avatar_url: null,
  };

  if (profile.avatar_path) {
    profile.avatar_url = await getSignedUrl(profile.avatar_path);
  }

  return profile;
}

/**
 * updateProfile(partial)
 * Writes to Auth user metadata and returns the merged profile.
 */
export async function updateProfile(partial = {}) {
  const user = await getCurrentUser();

  const allowed = [
    "fullName",
    "phone",
    "company",
    "title",
    "timezone",
    "avatar_path",
  ];
  const data = {};
  for (const k of allowed) {
    if (k in partial && partial[k] !== undefined) data[k] = partial[k];
  }

  const { data: upd, error } = await supabase.auth.updateUser({ data });
  if (error) throw error;

  const updatedUser = upd?.user || (await getCurrentUser());
  const m = updatedUser.user_metadata || {};
  const profile = {
    id: updatedUser.id,
    email: updatedUser.email ?? "",
    fullName: m.fullName ?? m.full_name ?? "",
    phone: m.phone ?? "",
    company: m.company ?? "",
    title: m.title ?? "",
    timezone: m.timezone ?? "America/Los_Angeles",
    avatar_path: m.avatar_path ?? "",
    avatar_url: null,
  };

  if (profile.avatar_path) {
    profile.avatar_url = await getSignedUrl(profile.avatar_path);
  }

  return profile;
}

/* --------------------------------- Avatar --------------------------------- */

/**
 * uploadAvatar(file: File)
 * Calls Edge Function `profile-avatar` via supabase.functions.invoke
 * so the SDK adds Authorization & apikey automatically.
 * Function returns { avatar_url } (signed) for immediate display.
 */
export async function uploadAvatar(file) {
  assert(typeof File !== "undefined" && file instanceof File, "No file provided");

  // Build multipart body without setting Content-Type (browser sets boundary)
  const form = new FormData();
  form.append("avatar", file, file.name || `${AVATAR_FILENAME}.png`);

  // Use the Supabase SDK so it injects the JWT + apikey for us
  const { data, error } = await supabase.functions.invoke("profile-avatar", {
    method: "POST",
    body: form,
    // DO NOT set headers; SDK adds Authorization/apikey and correct multipart headers
  });

  if (error) {
    // error contains { message, name }, but we keep a simple message up the stack
    throw new Error(error.message || "Avatar upload failed");
  }

  const avatar_url = data?.avatar_url || null;
  return { avatar_url };
}

/**
 * deleteAvatar()
 * Best-effort local cleanup: clears metadata's avatar_path and tries to remove
 * the file via Storage (may be blocked by RLS; that's OK).
 */
export async function deleteAvatar() {
  const user = await getCurrentUser();
  const path = user.user_metadata?.avatar_path;

  // Clear metadata regardless
  await supabase.auth.updateUser({ data: { avatar_path: "" } }).catch(() => null);

  if (!path) return { ok: true };

  // Attempt to delete (may be blocked by RLS—safe to ignore)
  await supabase.storage.from(AVATAR_BUCKET).remove([path]).catch(() => null);
  return { ok: true };
}
