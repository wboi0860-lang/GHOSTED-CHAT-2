-- GHOSTED: `ghosted_room`, `vip_room`, `vip_table`, `chats`, and `messages`
-- Run this script in your Supabase SQL Editor to ensure all dedicated tables are provisioned.

CREATE TABLE IF NOT EXISTS ghosted_room (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ghost_number TEXT UNIQUE,
  display_name TEXT,
  profile_pic TEXT,
  location TEXT,
  room_code TEXT,
  chat_with_ghost_number TEXT,
  call_with_ghost_number TEXT,
  call_status TEXT DEFAULT 'idle',
  game_type TEXT,
  game_data JSONB,
  last_active TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vip_room (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ghost_number TEXT UNIQUE,
  vip_status TEXT DEFAULT 'active',
  vip_games JSONB,
  vip_features JSONB
);

CREATE TABLE IF NOT EXISTS vip_table (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT,
  gh_number TEXT UNIQUE NOT NULL,
  is_vip BOOLEAN DEFAULT FALSE,
  vip_start_date TIMESTAMPTZ,
  vip_end_date TIMESTAMPTZ,
  plan TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  room_code TEXT UNIQUE NOT NULL,
  user1_gh TEXT NOT NULL,
  user2_gh TEXT NOT NULL,
  participants JSONB DEFAULT '[]'::jsonb,
  last_message TEXT,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  room_code TEXT NOT NULL,
  sender_gh TEXT NOT NULL,
  receiver_gh TEXT NOT NULL,
  text TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  deleted_for JSONB DEFAULT '[]'::jsonb,
  deleted_for_everyone BOOLEAN DEFAULT FALSE,
  game_code TEXT,
  game_type TEXT,
  game_link TEXT,
  map_session_id TEXT
);

CREATE TABLE IF NOT EXISTS location (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  gh_number TEXT NOT NULL,
  friend_gh TEXT NOT NULL,
  display_name TEXT,
  profile_pic TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  status TEXT DEFAULT 'pending',
  is_sharing BOOLEAN DEFAULT FALSE,
  inviter_gh TEXT,
  invitee_gh TEXT,
  stopped_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gh_number TEXT UNIQUE,
  vip_type TEXT,
  vip_expires_at TIMESTAMPTZ,
  paid_tag TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gh_number TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS vip_type TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS vip_expires_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS paid_tag TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS profiles_gh_number_uidx ON profiles (gh_number);

ALTER TABLE ghosted_room DISABLE ROW LEVEL SECURITY;
ALTER TABLE vip_room DISABLE ROW LEVEL SECURITY;
ALTER TABLE vip_table DISABLE ROW LEVEL SECURITY;
ALTER TABLE chats DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE location DISABLE ROW LEVEL SECURITY;
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'ghosted_room'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE ghosted_room;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'vip_room'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE vip_room;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'vip_table'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE vip_table;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'chats'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chats;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'location'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE location;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION delete_own_auth_user()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = auth.uid();
  END IF;
END;
$$;
