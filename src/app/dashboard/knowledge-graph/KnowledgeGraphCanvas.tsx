'use client';

import { useEffect, useRef, useState } from 'react';

export type CanvasNode = { id: string; department: string; taskType: string; brief: string; qualityScore: number; styleCluster: string; platform: string | null; audience: string | null; username: string; createdAt: string };
export type CanvasEdge = { source: string; target: string; weight: number; sourceType: 'stored' | 'derived'; type?: string };

type Point3D = CanvasNode & { x: number; y: number; z: number; color: string };
type Projected = Point3D & { sx: number; sy: number; scale: number; depth: number };

const palette = ['#8b8cf8', '#55c2b7', '#d5a85d', '#739adf', '#b77bd8', '#d2778a'];

function hash(value: string) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return Math.abs(result);
}

export default function KnowledgeGraphCanvas({ nodes, edges, selectedId, onSelect }: {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedId?: string;
  onSelect: (node: CanvasNode) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ rotationX: -0.18, rotationY: 0.48, zoom: 1.32, dragging: false, x: 0, y: 0 });
  const projectedRef = useRef<Projected[]>([]);
  const frameRef = useRef(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const departments = [...new Set(nodes.map(node => node.department))];
    const points: Point3D[] = nodes.map(node => {
      const departmentIndex = departments.indexOf(node.department);
      const departmentNodes = nodes.filter(item => item.department === node.department);
      const localIndex = departmentNodes.findIndex(item => item.id === node.id);
      const clusterAngle = departments.length > 1 ? departmentIndex / departments.length * Math.PI * 2 : 0;
      const localAngle = localIndex / Math.max(departmentNodes.length, 1) * Math.PI * 2 + (hash(node.id) % 100) / 100;
      const clusterRadius = departments.length > 1 ? 170 : 0;
      const localRadius = 42 + Math.min(115, departmentNodes.length * 5) * (0.55 + (hash(node.id + 'r') % 45) / 100);
      return {
        ...node,
        x: Math.cos(clusterAngle) * clusterRadius + Math.cos(localAngle) * localRadius,
        y: ((localIndex % 7) - 3) * 24 + Math.sin(localAngle) * localRadius * 0.42,
        z: Math.sin(clusterAngle) * clusterRadius + Math.sin(localAngle) * localRadius,
        color: palette[departmentIndex % palette.length],
      };
    });
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const render = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const state = stateRef.current;
      if (!state.dragging) state.rotationY += 0.00065;
      context.clearRect(0, 0, width, height);

      const gradient = context.createRadialGradient(width * 0.5, height * 0.47, 10, width * 0.5, height * 0.47, Math.max(width, height) * 0.62);
      gradient.addColorStop(0, 'rgba(40,43,65,.48)');
      gradient.addColorStop(0.5, 'rgba(15,17,24,.2)');
      gradient.addColorStop(1, 'rgba(8,9,12,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      const cosY = Math.cos(state.rotationY), sinY = Math.sin(state.rotationY);
      const cosX = Math.cos(state.rotationX), sinX = Math.sin(state.rotationX);
      const focal = 760;
      const projected = points.map(point => {
        const x1 = point.x * cosY - point.z * sinY;
        const z1 = point.x * sinY + point.z * cosY;
        const y1 = point.y * cosX - z1 * sinX;
        const z2 = point.y * sinX + z1 * cosX;
        const scale = focal / (focal + z2) * state.zoom;
        return { ...point, sx: width / 2 + x1 * scale, sy: height / 2 + y1 * scale, scale, depth: z2 };
      }).sort((a, b) => b.depth - a.depth);
      projectedRef.current = projected;
      const projectedById = new Map(projected.map(point => [point.id, point]));

      context.lineCap = 'round';
      const now = performance.now();
      edges.forEach((edge, edgeIndex) => {
        const source = projectedById.get(edge.source);
        const target = projectedById.get(edge.target);
        if (!source || !target) return;
        const alpha = Math.max(edge.sourceType === 'stored' ? 0.34 : 0.26, Math.min(0.58, ((source.scale + target.scale) / 2 - 0.2) * 0.36));
        context.beginPath();
        context.moveTo(source.sx, source.sy);
        context.lineTo(target.sx, target.sy);
        context.setLineDash(edge.sourceType === 'derived' ? [4, 5] : []);
        context.strokeStyle = edge.sourceType === 'stored' ? `rgba(186,190,216,${alpha})` : `rgba(139,137,255,${alpha})`;
        context.lineWidth = Math.max(edge.sourceType === 'stored' ? 1.25 : 1.05, edge.weight * 1.35);
        context.stroke();
        context.setLineDash([]);

        // A small signal travels along every stored relationship. Staggering each
        // edge keeps the network alive without turning the graph into decoration.
        const phase = ((now * 0.00016) + edgeIndex * 0.173) % 1;
        const pulseX = source.sx + (target.sx - source.sx) * phase;
        const pulseY = source.sy + (target.sy - source.sy) * phase;
        const pulseRadius = Math.max(1.1, 1.8 * ((source.scale + target.scale) / 2));
        const pulse = context.createRadialGradient(pulseX, pulseY, 0, pulseX, pulseY, pulseRadius * 4);
        pulse.addColorStop(0, edge.sourceType === 'stored' ? 'rgba(211,213,255,.95)' : 'rgba(164,163,255,.88)');
        pulse.addColorStop(0.3, 'rgba(113,112,255,.58)');
        pulse.addColorStop(1, 'rgba(113,112,255,0)');
        context.fillStyle = pulse;
        context.beginPath();
        context.arc(pulseX, pulseY, pulseRadius * 4, 0, Math.PI * 2);
        context.fill();
      });

      projected.forEach(point => {
        const selected = point.id === selectedId;
        const radius = (selected ? 7.5 : 4.2 + Math.min(point.qualityScore, 1) * 2) * point.scale;
        if (selected) {
          const glow = context.createRadialGradient(point.sx, point.sy, radius, point.sx, point.sy, radius * 5);
          glow.addColorStop(0, `${point.color}55`);
          glow.addColorStop(1, `${point.color}00`);
          context.fillStyle = glow;
          context.beginPath(); context.arc(point.sx, point.sy, radius * 5, 0, Math.PI * 2); context.fill();
        }
        context.shadowBlur = selected ? 18 : Math.max(3, point.scale * 6);
        context.shadowColor = point.color;
        context.fillStyle = point.color;
        context.globalAlpha = Math.max(0.32, Math.min(1, point.scale));
        context.beginPath(); context.arc(point.sx, point.sy, radius, 0, Math.PI * 2); context.fill();
        context.shadowBlur = 0;
        context.globalAlpha = 1;
        context.strokeStyle = selected ? '#f7f8f8' : 'rgba(255,255,255,.28)';
        context.lineWidth = selected ? 1.5 : 0.65;
        context.stroke();
      });
      frameRef.current = requestAnimationFrame(render);
    };
    frameRef.current = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(frameRef.current); observer.disconnect(); };
  }, [nodes, edges, selectedId]);

  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const state = stateRef.current;
    state.dragging = true; state.x = event.clientX; state.y = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
  };
  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const state = stateRef.current;
    if (!state.dragging) return;
    state.rotationY += (event.clientX - state.x) * 0.006;
    state.rotationX = Math.max(-1.1, Math.min(1.1, state.rotationX + (event.clientY - state.y) * 0.004));
    state.x = event.clientX; state.y = event.clientY;
  };
  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const state = stateRef.current;
    const movement = Math.hypot(event.clientX - state.x, event.clientY - state.y);
    state.dragging = false; setDragging(false);
    if (movement < 8) {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      const hit = [...projectedRef.current].reverse().find(point => Math.hypot(point.sx - x, point.sy - y) < Math.max(10, 9 * point.scale));
      if (hit) onSelect(hit);
    }
  };

  return <div className="relative h-[590px] w-full overflow-hidden bg-[#08090c]">
    <canvas ref={canvasRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onWheel={event => { event.preventDefault(); stateRef.current.zoom = Math.max(0.55, Math.min(2.1, stateRef.current.zoom - event.deltaY * 0.001)); }}
      className={`h-full w-full touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`} />
    <div className="pointer-events-none absolute bottom-4 left-4 rounded-md border border-white/[.07] bg-black/30 px-2.5 py-1.5 text-[11px] text-[#737780] backdrop-blur-md">Drag to rotate · Scroll to zoom · Select a node for details</div>
    <div className="pointer-events-none absolute right-4 top-4 rounded-md border border-white/[.07] bg-black/40 px-3 py-2 text-[10px] text-[#858a94] backdrop-blur-md">
      <div className="flex items-center gap-2"><span className="h-px w-5 bg-[#a4a8c2]" />Stored edge</div>
      <div className="mt-1.5 flex items-center gap-2"><span className="w-5 border-t border-dashed border-[#7776e5]" />Derived view edge</div>
      <div className="mt-1.5 flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#8b8cf8] shadow-[0_0_7px_#8b8cf8]" />Animated live signal</div>
    </div>
  </div>;
}
