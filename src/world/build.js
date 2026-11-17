// Construcción completa de una sala (geometría + luz + colisionadores) como generador.
import { RoomBuilder } from './brush.js';
import { meshRoom } from './mesh.js';
import { roomOrigin } from './layout.js';

export function* buildRoom(room) {
  const rb = new RoomBuilder(room);
  room.def.build(rb, room);
  return yield* meshRoom(rb, roomOrigin(room));
}
export function buildRoomSync(room) {
  const g = buildRoom(room);
  let r;
  while (!(r = g.next()).done);
  return r.value;
}
