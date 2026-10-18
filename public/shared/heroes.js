export const HEROES = [
  { id: 'kyah',     name: 'Kyah',      color: '#5B8DEF', blurb: 'Flower fairy. Bloom!' },
  { id: 'ayva',     name: 'Ayva',      color: '#E86BB5', blurb: 'Music fairy. La-la!' },
  { id: 'pup',      name: 'Charli',    color: '#F2B544', blurb: 'Brave puppy. Woof!' },
  { id: 'poodle',   name: 'Poodle',    color: '#A8E0B8', blurb: 'Fluffy and fancy.' },
  { id: 'misssuds', name: 'Miss Suds', color: '#4FB5A3', blurb: 'Runs the Puddle Paws Pet Wash.' },
  { id: 'baker',    name: 'Benny',     color: '#C97B3A', blurb: 'The Sunbeam baker. Fresh buns, brighter days!' },
];
export const HERO_BY_ID = Object.fromEntries(HEROES.map(h => [h.id, h]));
