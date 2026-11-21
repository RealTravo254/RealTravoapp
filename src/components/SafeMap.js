import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { View, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import MapView, { Marker, Polyline, Callout } from 'react-native-maps';
import { getPosition } from '../lib/geo';

// Maps that never crash the app.
//  - With a Google Maps key built into the app: the normal Google map.
//  - Without a key: an OpenStreetMap map (Leaflet in a WebView) that supports the same markers, lines, tapping and zoom-to-fit. No key needed.
const cfg = Constants.expoConfig || {};
const key = Platform.OS === 'android' ? cfg.android?.config?.googleMaps?.apiKey : cfg.ios?.config?.googleMapsApiKey;
export const mapsReady = Platform.OS === 'ios' || (!!key && !String(key).startsWith('YOUR_'));

const COLORS = { blue: '#2F6FDE', green: '#2E9E5B', orange: '#E8890C', red: '#E0455C', violet: '#8E44AD', yellow: '#E6B800', cyan: '#0E9AA7' };
const flat = (ch) => { let o = ''; React.Children.forEach(ch, (c) => { if (typeof c === 'string' || typeof c === 'number') o += c; else if (c?.props) o += flat(c.props.children); }); return o; };

function collect(children, out = { markers: [], lines: [] }) {
  React.Children.forEach(children, (c) => {
    if (!c || !c.type) return;
    if (c.type === Marker) {
      const co = c.props.coordinate; if (!co) return;
      const texts = [], actions = []; let calloutPress = null;
      React.Children.forEach(c.props.children, (k) => {
        if (k?.type === Callout) {
          calloutPress = k.props.onPress;
          React.Children.forEach(k.props.children, (t) => {
            if (typeof t === 'string') texts.push(t);
            else if (t?.props) { const inner = flat(t.props.children); if (t.props.onPress) actions.push({ label: inner, fn: t.props.onPress }); else texts.push(inner); }
          });
        }
      });
      out.markers.push({ lat: co.latitude, lng: co.longitude, color: COLORS[c.props.pinColor] || '#1B4432', title: c.props.title, description: c.props.description, texts, actions, onPress: c.props.onPress, calloutPress });
    } else if (c.type === Polyline) {
      out.lines.push({ pts: (c.props.coordinates || []).map((p) => [p.latitude, p.longitude]), color: c.props.strokeColor || '#1B4432', w: c.props.strokeWidth || 4 });
    } else if (c.props?.children) collect(c.props.children, out);
  });
  return out;
}

const html = (lat, lng, zoom) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#m{height:100%;margin:0;background:#E3EDE8}.pin{display:inline-block;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);vertical-align:middle}
.marker-label{display:inline-block;max-width:180px;margin-left:4px;padding:3px 6px;border-radius:8px;background:#fff;color:#14231c;font:700 10px sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.4);vertical-align:middle;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.marker-label small{display:block;color:#65746c;font:500 9px sans-serif}
.leaflet-popup-content{font-family:sans-serif}.leaflet-popup-content button{margin:6px 6px 0 0;padding:7px 12px;border:0;border-radius:8px;background:#1B4432;color:#fff;font-weight:700}</style></head>
<body><div id="m"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
var map=L.map('m').setView([${lat},${lng}],${zoom});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var layer=L.layerGroup().addTo(map),me=null;
function send(o){window.ReactNativeWebView.postMessage(JSON.stringify(o));}
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
map.on('click',function(e){send({t:'press',lat:e.latlng.lat,lng:e.latlng.lng});});
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('button[data-t]');if(b)send({t:b.getAttribute('data-t'),i:+b.getAttribute('data-i'),j:+b.getAttribute('data-j')});});
window.setData=function(d){layer.clearLayers();
 d.lines.forEach(function(l){L.polyline(l.pts,{color:l.color,weight:l.w}).addTo(layer);});
 d.markers.forEach(function(m,i){
  var label=m.title?'<span class="marker-label">↗ '+esc(m.title)+(m.description?'<small>'+esc(m.description)+'</small>':'')+'</span>':'';
  var ic=L.divIcon({className:'',html:'<span class="pin" style="background:'+m.color+'"></span>'+label,iconSize:[210,24],iconAnchor:[9,12]});
  var mk=L.marker([m.lat,m.lng],{icon:ic}).addTo(layer);
  var head=m.title||m.texts[0]||'', rest=m.title?m.texts:m.texts.slice(1);
  if(head||m.hasCallout||m.actions.length){var h='<b>'+esc(head)+'</b>';if(m.description)h+='<br>'+esc(m.description);rest.forEach(function(t){h+='<br>'+esc(t);});
   if(m.hasCallout)h+='<br><button data-t="callout" data-i="'+i+'">Details</button>';
   m.actions.forEach(function(a,j){h+='<button data-t="action" data-i="'+i+'" data-j="'+j+'">'+esc(a)+'</button>';});mk.bindPopup(h);}
  mk.on('click',function(){send({t:'marker',i:i});});});};
window.fit=function(pts,pad){if(pts&&pts.length>1)map.fitBounds(pts,{padding:[pad,pad]});else if(pts&&pts.length===1)map.setView(pts[0],14);};
window.go=function(lat,lng,z){map.setView([lat,lng],z);};
window.setMe=function(lat,lng){if(me)map.removeLayer(me);me=L.circleMarker([lat,lng],{radius:8,color:'#fff',weight:3,fillColor:'#2F6FDE',fillOpacity:1}).addTo(map);};
send({t:'ready'});
</script></body></html>`;

const OsmMap = forwardRef(function OsmMap(props, ref) {
  const web = useRef(null); const [ready, setReady] = useState(false);
  const reg = props.initialRegion || { latitude: -4.5, longitude: 36.5, latitudeDelta: 12 };
  const zoom = Math.max(3, Math.min(17, Math.round(Math.log2(360 / (reg.latitudeDelta || 12)))));
  const source = useMemo(() => ({ html: html(reg.latitude, reg.longitude, zoom), baseUrl: 'https://realtravo.com/' }), []);
  const data = collect(props.children); const dataKey = JSON.stringify(data.markers.map((m) => [m.lat, m.lng, m.color, m.title, m.description, m.texts, m.actions.map((a) => a.label), !!m.calloutPress])) + JSON.stringify(data.lines);
  const run = (js) => web.current?.injectJavaScript(js + ';true;');
  useImperativeHandle(ref, () => ({
    fitToCoordinates: (coords, o) => run(`window.fit(${JSON.stringify(coords.map((c) => [c.latitude, c.longitude]))},${o?.edgePadding?.top ? 40 : 30})`),
    animateToRegion: (r) => run(`window.go(${r.latitude},${r.longitude},${Math.max(3, Math.min(17, Math.round(Math.log2(360 / (r.latitudeDelta || 0.05)))))})`),
    animateCamera: (o) => run(`window.go(${o.center.latitude},${o.center.longitude},${o.zoom || 15})`),
  }));
  useEffect(() => { if (!ready) return; run(`window.setData(${JSON.stringify({ lines: data.lines, markers: data.markers.map((m) => ({ lat: m.lat, lng: m.lng, color: m.color, title: m.title, description: m.description, texts: m.texts, hasCallout: !!m.calloutPress, actions: m.actions.map((a) => a.label) })) })})`); }, [ready, dataKey]);
  useEffect(() => { if (ready && props.showsUserLocation) getPosition({ silent: true }).then((p) => p && run(`window.setMe(${p.lat},${p.lng})`)); }, [ready]);
  const onMessage = (e) => {
    let m; try { m = JSON.parse(e.nativeEvent.data); } catch (x) { return; }
    if (m.t === 'ready') setReady(true);
    else if (m.t === 'press') props.onPress?.({ nativeEvent: { coordinate: { latitude: m.lat, longitude: m.lng } } });
    else if (m.t === 'marker') data.markers[m.i]?.onPress?.();
    else if (m.t === 'callout') data.markers[m.i]?.calloutPress?.();
    else if (m.t === 'action') data.markers[m.i]?.actions[m.j]?.fn?.();
  };
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: '#E3EDE8' }, props.style]}>
      <WebView ref={web} source={source} originWhitelist={['*']} javaScriptEnabled domStorageEnabled onMessage={onMessage} style={{ flex: 1, backgroundColor: 'transparent' }} setSupportMultipleWindows={false} />
    </View>
  );
});

const SafeMap = forwardRef(function SafeMap(props, ref) {
  return mapsReady ? <MapView ref={ref} {...props} /> : <OsmMap ref={ref} {...props} />;
});
export default SafeMap;
export { Marker, Polyline, Callout };
