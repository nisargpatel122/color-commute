// Shared constants. GAME_ID must match the repository name.
export const GAME_ID = 'color-commute';
export const VERSION = 2;

// 8 commuter colors, each with its own symbol for colorblind play.
export const COLORS = [
  { name: 'Red',    hex: '#ef4b4b', dark: '#b8303a', light: '#ff8a7a', sym: 'heart' },
  { name: 'Orange', hex: '#ff9a2e', dark: '#c9681a', light: '#ffc078', sym: 'triangle' },
  { name: 'Yellow', hex: '#ffd23a', dark: '#c99a14', light: '#fff08a', sym: 'star' },
  { name: 'Green',  hex: '#3fc46a', dark: '#24894a', light: '#8ae8a2', sym: 'square' },
  { name: 'Blue',   hex: '#3d86f0', dark: '#2459b8', light: '#8ab8ff', sym: 'circle' },
  { name: 'Purple', hex: '#9b5cf0', dark: '#6a37b5', light: '#c6a0ff', sym: 'diamond' },
  { name: 'Pink',   hex: '#ff6fb5', dark: '#c4447f', light: '#ffb0d8', sym: 'cross' },
  { name: 'Teal',   hex: '#1fc2c2', dark: '#13888c', light: '#7ff0e8', sym: 'moon' },
];

export const BOOSTERS = {
  bay:     { name: 'Extra Bay', cost: 60, unlock: 5,  desc: 'Opens the 6th bay for this level.' },
  lift:    { name: 'Lift',      cost: 80, unlock: 8,  desc: 'Pick any vehicle and lift it straight to a bay.' },
  sort:    { name: 'Sort',      cost: 50, unlock: 10, desc: 'Reorders the next riders so they can board now.' },
  shuffle: { name: 'Shuffle',   cost: 70, unlock: 16, desc: 'Re-colors the lot. Still winnable!' },
};
