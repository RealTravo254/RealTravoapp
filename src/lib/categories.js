export const CATS = [
  { key: 'hotel', icon: 'bed-outline', color: '#2F6FDE' },
  { key: 'campsite', icon: 'bonfire-outline', color: '#2E9E5B' },
  { key: 'airbnb', icon: 'home-outline', color: '#E0455C' },
  { key: 'activity', icon: 'bicycle-outline', color: '#8E44AD' },
  { key: 'guide', icon: 'compass-outline', color: '#0E9AA7' },
];
export const catColor = (k) => CATS.find((c) => c.key === k)?.color || '#1B4432';
export const catIcon = (k) => CATS.find((c) => c.key === k)?.icon || 'apps-outline';
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
export const AMENITIES = ['Wi-Fi', 'Parking', 'Swimming pool', 'Restaurant', 'Bar', 'Air conditioning', 'Breakfast included', 'Pets allowed', 'Laundry', 'Gym', 'Spa',
  'Airport shuttle', '24h reception', 'Kitchen', 'TV', 'Hot water', 'Power backup', 'Toilets', 'Showers', 'Fire pit', 'Family friendly', 'Wheelchair access', 'Free drinking water', 'Security'];