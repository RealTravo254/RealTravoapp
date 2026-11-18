-- Run once in Supabase > SQL Editor (adds the app-update announcement fields used by Admin > Settings)
alter table app_settings add column if not exists latest_version text not null default '1.0.0';
alter table app_settings add column if not exists min_version text not null default '1.0.0';
alter table app_settings add column if not exists update_url text;
alter table app_settings add column if not exists update_message text;
