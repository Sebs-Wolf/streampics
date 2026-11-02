// A fixed studio light reflected in the card's local coordinate system.
// Rotation is the only input: cursor position and zoom cannot change the finish.
export function foilLighting(pitch,yaw){
 const x=pitch*Math.PI/180,y=yaw*Math.PI/180,sx=Math.sin(x),cx=Math.cos(x),sy=Math.sin(y),cy=Math.cos(y);
 const length=Math.hypot(-.22,-.32,1),hx=-.22/length,hy=-.32/length,hz=1/length;
 const lx=cy*hx+sx*sy*hy-cx*sy*hz,ly=cx*hy+sx*hz,lz=sy*hx-sx*cy*hy+cx*cy*hz;
 const facing=Math.max(0,cx*cy),specular=Math.pow(Math.max(0,lz),14);
 return {x:50+lx*105,y:50+ly*105,angle:115+sy*28+sx*12,opacity:facing*(.08+.22*specular)};
}
