export interface NeverHaveIEverPrompt {
  question: string;
  emoji: string;
}

export const NEVER_HAVE_I_EVER_PROMPTS: NeverHaveIEverPrompt[] = [
  {
    question: 'Never have I ever texted the wrong person a screenshot meant for my best friend.',
    emoji: '📱',
  },
  {
    question: 'Never have I ever stayed up until 4 AM talking to someone I just met.',
    emoji: '🌙',
  },
  {
    question: 'Never have I ever pretended to be busy just to avoid a phone call.',
    emoji: '🤫',
  },
  {
    question: 'Never have I ever stalked someone’s profile from years ago by accident.',
    emoji: '👀',
  },
  {
    question: 'Never have I ever eaten food off the floor when nobody was looking.',
    emoji: '🍕',
  },
  {
    question: 'Never have I ever lied about my battery dying to leave a conversation.',
    emoji: '🔋',
  },
  {
    question: 'Never have I ever laughed out loud at a serious moment.',
    emoji: '😂',
  },
  {
    question: 'Never have I ever forgotten someone’s name seconds after being introduced.',
    emoji: '😅',
  },
  {
    question: 'Never have I ever typed a long paragraph and deleted the whole thing.',
    emoji: '💬',
  },
  {
    question: 'Never have I ever re-read old chats just to smile.',
    emoji: '🥰',
  },
  {
    question: 'Never have I ever pretended to understand a joke when I had no clue.',
    emoji: '🙃',
  },
  {
    question: 'Never have I ever ghosted someone and later realized they were right next to me.',
    emoji: '👻',
  },
  {
    question: 'Never have I ever gone out without checking how much money was in my account.',
    emoji: '💸',
  },
  {
    question: 'Never have I ever blamed lag or poor network when I actually lost a game.',
    emoji: '🎮',
  },
  {
    question: 'Never have I ever sent a risky message and immediately turned off my phone.',
    emoji: '🔥',
  },
  {
    question: 'Never have I ever practiced an argument in the mirror.',
    emoji: '🪞',
  },
  {
    question: 'Never have I ever told someone "I am on the way" while still in bed.',
    emoji: '🛏️',
  },
  {
    question: 'Never have I ever watched an entire series in one weekend.',
    emoji: '📺',
  },
  {
    question: 'Never have I ever accidentally liked a post from 3 years ago.',
    emoji: '❤️',
  },
  {
    question: 'Never have I ever kept a secret that was way too funny to keep.',
    emoji: '🤭',
  },
  {
    question: 'Never have I ever dressed up just to take photos and stay home.',
    emoji: '📸',
  },
  {
    question: 'Never have I ever blamed someone else for something I broke.',
    emoji: '🫣',
  },
  {
    question: 'Never have I ever sung at the top of my lungs in the shower.',
    emoji: '🚿',
  },
  {
    question: 'Never have I ever wished someone a happy birthday a week late.',
    emoji: '🎂',
  },
  {
    question: 'Never have I ever had a drink to celebrate a random Tuesday night.',
    emoji: '🍺',
  },
];

export interface WouldYouRatherPrompt {
  id: number;
  emoji: string;
  emojiA: string;
  emojiB: string;
  optionA: string;
  optionB: string;
}

export const WOULD_YOU_RATHER_PROMPTS: WouldYouRatherPrompt[] = [
  { id: 1, emoji: '💬', emojiA: '⏳', emojiB: '📢', optionA: 'Have every text you send auto-delete in 24h', optionB: 'Keep every text forever in public' },
  { id: 2, emoji: '🕵️', emojiA: '🔍', emojiB: '🎭', optionA: 'Always know when someone is lying', optionB: 'Never get caught lying' },
  { id: 3, emoji: '📵', emojiA: '📱', emojiB: '🎵', optionA: 'Live without your phone for 1 year', optionB: 'Live without music for 1 year' },
  { id: 4, emoji: '💰', emojiA: '💵', emojiB: '🎲', optionA: 'Win $100,000 today', optionB: 'Have a 50% chance at $1,000,000' },
  { id: 5, emoji: '🗣️', emojiA: '🤫', emojiB: '📣', optionA: 'Only be able to whisper', optionB: 'Only be able to shout' },
  { id: 6, emoji: '🌍', emojiA: '✈️', emojiB: '🍽️', optionA: 'Travel anywhere free forever', optionB: 'Eat any meal free forever' },
  { id: 7, emoji: '🤝', emojiA: '🌟', emojiB: '🫶', optionA: 'Have 10M followers online', optionB: 'Have 3 super loyal real-life friends' },
  { id: 8, emoji: '🧠', emojiA: '🌐', emojiB: '🎸', optionA: 'Speak every language fluently', optionB: 'Play every instrument perfectly' },
  { id: 9, emoji: '🦸', emojiA: '🔮', emojiB: '👻', optionA: 'Read minds for 10 minutes a day', optionB: 'Turn invisible for 10 minutes a day' },
  { id: 10, emoji: '⚡', emojiA: '🌙', emojiB: '🍔', optionA: 'Never need to sleep again', optionB: 'Never need to eat again' },
  { id: 11, emoji: '🚀', emojiA: '🏢', emojiB: '🏝️', optionA: 'Start your own billion-dollar startup', optionB: 'Retire right now with $5M' },
  { id: 12, emoji: '⏰', emojiA: '🐇', emojiB: '🐢', optionA: 'Always be 20 minutes early', optionB: 'Always be 10 minutes late' },
  { id: 13, emoji: '🎯', emojiA: '📸', emojiB: '🎮', optionA: 'Give up social media forever', optionB: 'Give up gaming forever' },
  { id: 14, emoji: '🕰️', emojiA: '🚀', emojiB: '⏮️', optionA: 'Meet your future self in 20 years', optionB: 'Revisit one day from your past' },
  { id: 15, emoji: '🔋', emojiA: '📶', emojiB: '⚡', optionA: 'Have unlimited Wi-Fi anywhere on Earth', optionB: 'Have infinite phone battery forever' },
  { id: 16, emoji: '🍿', emojiA: '🎬', emojiB: '📺', optionA: 'Only watch movies from now on', optionB: 'Only watch series from now on' },
  { id: 17, emoji: '🏡', emojiA: '🏙️', emojiB: '🏖️', optionA: 'Live in a penthouse in the city', optionB: 'Live in a quiet beachfront villa' },
  { id: 18, emoji: '🗂️', emojiA: '🖼️', emojiB: '📇', optionA: 'Lose all your old photos', optionB: 'Lose all your saved contacts' },
  { id: 19, emoji: '💭', emojiA: '🎤', emojiB: '🤐', optionA: 'Always say what you are thinking', optionB: 'Never speak again in group chats' },
  { id: 20, emoji: '✨', emojiA: '🦅', emojiB: '🌀', optionA: 'Fly anywhere at 500 mph', optionB: 'Teleport once per week' },
  { id: 21, emoji: '👑', emojiA: '👨‍🍳', emojiB: '🚘', optionA: 'Have a personal chef', optionB: 'Have a personal chauffeur' },
  { id: 22, emoji: '🌅', emojiA: '🦉', emojiB: '🐦', optionA: 'Night owl forever', optionB: 'Early bird forever' },
  { id: 23, emoji: '💖', emojiA: '💘', emojiB: '💎', optionA: 'Find true love tomorrow', optionB: 'Double your dream income tomorrow' },
  { id: 24, emoji: '📲', emojiA: '📞', emojiB: '⌨️', optionA: 'Voice call for 3 hours', optionB: 'Text nonstop for 3 hours' },
  { id: 25, emoji: '🏆', emojiA: '✊', emojiB: '🎭', optionA: 'Play Rock Paper Scissors for $1,000', optionB: 'Play Two Truths One Lie for $1,000' },
];
