import { GhostAvatarConfig } from './utils/ghostAvatar';

export type FreeGameType = 'rps' | 'tictactoe' | 'twotruths';
export type VipGameType = 'nhie' | 'wyr';
export type CallStatus = 'idle' | 'ringing' | 'active' | 'ended';
export type CurrencyCode = 'NGN' | 'USD';
export type VipPlanType = 'daily' | 'monthly' | 'yearly' | 'trial_1h';

export interface TrackerEntry {
  id: string;
  kind: 'chat' | 'call' | 'game' | 'map';
  peer_ghost_number: string;
  peer_name?: string;
  room_code: string;
  summary: string;
  timestamp: string;
  expires_at?: string;
  status?: string;
}

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined';

export interface FriendRequestRecord {
  id: string;
  sender: string; // GH-XXXX
  receiver: string; // GH-XXXX
  status: FriendRequestStatus;
  sender_name?: string;
  sender_pic?: string;
  sender_is_vip?: boolean;
  receiver_name?: string;
  receiver_pic?: string;
  receiver_is_vip?: boolean;
  created_at: string;
  updated_at: string;
}

export interface GhostProfileGameData {
  kind?: 'profile';
  status?: string;
  email?: string;
  auth_user_id?: string;
  location_hidden?: boolean;
  gh_number_hidden?: boolean;
  is_vip?: boolean;
  vip_start_date?: string | null;
  vip_end_date?: string | null;
  vip_plan?: string | null;
  friends?: string[];
  blocked_users?: string[];
  legal_accepted_at?: string;
  tracker?: TrackerEntry[];
}

export interface GhostRoomProfile {
  id?: number;
  ghost_number: string; // GH-XXXX ONLY
  display_name: string;
  profile_pic: string; // serialized GhostAvatarConfig, "EMOJI:🦊", or photo URL/dataURI
  location: string; // "City, Country" or "Hidden"
  status?: string;
  email?: string;
  auth_user_id?: string;
  location_hidden?: boolean;
  gh_number_hidden?: boolean;
  is_vip?: boolean;
  vip_start_date?: string | null;
  vip_end_date?: string | null;
  vip_plan?: string | null;
  vip_type?: 'MAIN' | 'GAME' | 'BOTH' | null;
  vip_expires_at?: string | null;
  paid_tag?: string | null;
  blocked_users?: string[];
  legal_accepted_at?: string;
  room_code?: string | null;
  chat_with_ghost_number?: string | null;
  call_with_ghost_number?: string | null;
  call_status?: CallStatus;
  game_type?: string | null;
  game_data?: GhostProfileGameData | null;
  last_active?: string;
  avatar_config?: GhostAvatarConfig;
}

export interface ChatMessage {
  id: string;
  from: string; // GH-XXXX
  to: string; // GH-XXXX
  text: string;
  timestamp: string;
  expires_at?: string;
  deleted_for?: string[];
  deleted_for_everyone?: boolean;
  gameCode?: string;
  gameType?: FreeGameType;
  gameLink?: string;
  mapSessionId?: string;
}

export interface ChatRoomRow {
  room_code: string; // GH-A-GH-B sorted
  participants: string[]; // max 2
  messages: ChatMessage[];
  created_at: string;
  expires_at: string;
  last_active: string;
}

export interface ConversationPreview {
  room_code: string;
  peer_ghost_number: string;
  peer_name: string;
  peer_pic: string;
  peer_is_vip?: boolean;
  peer_last_active?: string;
  last_message: string;
  last_timestamp: string;
  expires_at: string;
}

export interface MapParticipant {
  ghost_number: string;
  display_name: string;
  profile_pic: string;
  lat: number;
  lng: number;
  updated_at: string;
}

export interface MapSessionData {
  kind: 'map';
  session_id: string;
  room_code: string;
  inviter: string;
  invitee: string;
  status: 'pending' | 'accepted' | 'declined' | 'ended' | 'stopped';
  stopped_by?: string;
  stopped_at?: string;
  participants: Record<string, MapParticipant>;
  created_at: string;
  expires_at: string;
}

export interface RpsState {
  choices: Record<string, 'rock' | 'paper' | 'scissors' | null>;
  scores: Record<string, number>;
  phase: 'choosing' | 'countdown' | 'reveal';
  winner: string | 'draw' | null;
}

export interface TicTacToeState {
  board: Array<'X' | 'O' | null>;
  turn: 'X' | 'O';
  playerX: string;
  playerO: string | null;
  winner: 'X' | 'O' | 'draw' | null;
  winLine: number[] | null;
}

export interface TwoTruthsState {
  writer: string;
  guesser: string | null;
  statements: string[]; // 3 items (shuffled before display)
  lieIndex: number | null;
  guessIndex: number | null;
  revealed: boolean;
  winner?: 'writer' | 'guesser' | null;
  scores: Record<string, number>;
}

export interface FreeGameRoomData {
  kind: 'game';
  room_code: string; // 6-char code e.g. ABC123
  game_type: FreeGameType;
  host: string; // GH-XXXX
  players: string[]; // max 2
  round: number;
  created_at: string;
  updatedAt?: number;
  leftPlayer?: 'Player 1' | 'Player 2' | null;
  leftAt?: string | null;
  rps?: RpsState;
  tictactoe?: TicTacToeState;
  twotruths?: TwoTruthsState;
}

export interface VipGamesUnlock {
  nhie: boolean;
  wyr: boolean;
  nhie_paid?: boolean;
  wyr_paid?: boolean;
  nhie_expires_at?: string | null;
  wyr_expires_at?: string | null;
  vip_games_expires_at?: string | null;
  paid_currency?: CurrencyCode;
  paid_reference?: string;
}

export interface VipFeaturesConfig {
  goldBadge: boolean;
  secretGhostMode: boolean;
  vipThemeGlow: boolean;
  main_vip_active?: boolean;
  vip_plan?: VipPlanType;
  vip_expires_at?: string | null;
  paidCurrency?: CurrencyCode;
  paidReference?: string;
  paidAt?: string;
}

export interface VipRoomRecord {
  id?: number;
  ghost_number: string;
  vip_status: 'active' | 'inactive';
  vip_type?: 'MAIN' | 'GAME' | 'BOTH' | null;
  vip_expires_at?: string | null;
  paid_tag?: string | null;
  vip_games: VipGamesUnlock;
  vip_features: VipFeaturesConfig;
}

export interface VipGameSessionData {
  kind: 'vip_game';
  room_code: string;
  game_type: VipGameType;
  host: string;
  players: string[];
  prompt_index: number;
  votes: Record<string, string>; // GH-XXXX -> choice
  created_at: string;
  updatedAt?: number;
  leftPlayer?: 'Player 1' | 'Player 2' | null;
  leftAt?: string | null;
}

export interface ActiveCallState {
  roomCode: string;
  peerGhostNumber: string;
  peerName: string;
  peerPic: string;
  direction: 'outgoing' | 'incoming';
  status: 'calling' | 'ringing' | 'active' | 'ended';
  durationSeconds: number;
  isMuted: boolean;
  isSpeakerOn: boolean;
}

export interface IdeaRecord {
  id: string;
  ghost_number: string;
  text: string;
  likes: number;
  created_at: string;
  expires_at?: string;
}
