export const ADMIN_PAGES = [
  { key: 'listings', title: 'Listings', icon: 'images-outline', description: 'Review and moderate listings.' },
  { key: 'providers', title: 'Providers', icon: 'business-outline', description: 'Review host business registrations.' },
  { key: 'trips', title: 'Trips & no-shows', icon: 'ticket-outline', description: 'Review custom trips and no-show reports.' },
  { key: 'vehicles', title: 'Vehicles', icon: 'car-outline', description: 'Manage transfer vehicle types.' },
  { key: 'destinations', title: 'Destinations', icon: 'earth-outline', description: 'Manage destination cards.' },
  { key: 'payouts', title: 'Payout methods', icon: 'card-outline', description: 'Manage host payout methods.' },
  { key: 'countries', title: 'Countries', icon: 'flag-outline', description: 'Manage supported countries.' },
  { key: 'cities', title: 'Cities', icon: 'location-outline', description: 'Manage cities.' },
  { key: 'regions', title: 'Regions', icon: 'map-outline', description: 'Manage regions and counties.' },
  { key: 'airports', title: 'Airports', icon: 'airplane-outline', description: 'Manage airport locations.' },
  { key: 'dropoffs', title: 'Drop-offs', icon: 'navigate-outline', description: 'View private booking drop-off details.' },
  { key: 'host_ids', title: 'Host IDs', icon: 'shield-checkmark-outline', description: 'Review host identity documents.' },
  { key: 'fees', title: 'Category fees', icon: 'pricetag-outline', description: 'Manage booking commission rates.' },
  { key: 'legal', title: 'Legal documents', icon: 'document-text-outline', description: 'Review and publish terms and privacy.' },
  { key: 'settings', title: 'Settings', icon: 'settings-outline', description: 'Manage app settings and version notices.' },
  { key: 'host_balances', title: 'Host payouts', icon: 'wallet-outline', description: 'Review balances and manage trip-based payout batches.' },
];

export const ADMIN_PERMISSION_PAGES = ADMIN_PAGES.filter((page) => !page.superOnly);
