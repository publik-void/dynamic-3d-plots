import * as THREE from 'three';

// The module is called `dynamic-3d-plots` because I might generalize this to
// different kinds of plots, but at the moment it's only about plotting IMU
// sensor trajectories. We'll see if and by how much I'll extend this in the
// future.

// TODO: Replace `let`s by `const`s where possible

export function pagePrefersDark(_window = window) {
  let mediaQueryObj = _window.matchMedia('(prefers-color-scheme: dark)');
  return mediaQueryObj.matches;
}

export async function loadSensorData(url) {
  return (await fetch(url)).json();
}

function sublength(xss, agg = Math.min) {
  return agg(...Object.values(xss).map(xs => xs.length));
}

function trajectoryBoxesOriginsMap(posEarth,
    f = x => [Math.floor(x)], init = new Map(), dims = ["x", "y", "z"]) {
  let out = init;
  for (let sensor of Object.keys(posEarth)) {
    let n = sublength(posEarth[sensor]);
    for (let i = 0; i < n; i++) {
      let submaps = [out];
      for (let dim of dims) {
        let os = f(posEarth[sensor][dim][i], dim);
        function sub(m, o) {
          if (!m.has(o)) { m.set(o, new Map()); }
          return m.get(o);
        }
        submaps = submaps.flatMap(submap => os.map(o => sub(submap, o)));
      }
    }
  }
  return out;
}

function boxesOriginsMapAsArray(map) {
  return [...map.keys()].flatMap(i => {
      let submap = map.get(i);
      if (submap.size == 0) {
        return [[i]];
      } else {
        return boxesOriginsMapAsArray(submap).map(is => [i, ...is]);
      }
    });
}

function computeSubticks(start = 0, end = 1, stepSizes = [], depth = 0,
    out = []) {
  if (stepSizes.length > 0) {
    let [s, ...ss] = stepSizes;
    let x0 = start;
    while (true) {
      let x1 = x0 + s
      computeSubticks(x0, x1, ss, depth + 1, out);
      x0 = x1;
      if (x0 < end) {
        out.push({pos: x0, depth: depth});
      } else {
        break;
      }
    }
  }
  return out;
}

function computeTicks(start = 0, end = 1, stepSizes = []) {
  let out = [{pos: start, depth: -1}];
  computeSubticks(start, end, stepSizes, 0, out);
  out.push({pos: end, depth: -2});
  return out;
}

function computeGridSubspaces(tickss, dims = new Set([]),
    starts = tickss.map(ticks => Math.min(...ticks.map(tick => tick.pos))),
    ends = tickss.map(ticks => Math.max(...ticks.map(tick => tick.pos))),
    subspaces = []) {
  if (tickss.length == 0) {
    return [{vertices: Array(1 << dims.size).fill([]), depths: []}];
  } else {
    let [ts, ...tss] = tickss;
    let subsubspaces = computeGridSubspaces(tss,
      new Set([...dims].map(dim => dim - 1).filter(dim => dim >= 0)),
      starts.slice(1), ends.slice(1))
    for (let subsubspace of subsubspaces) {
      if (dims.has(0)) {
        let subspace = {
          vertices: subsubspace.vertices.flatMap(vertex =>
            [[starts[0]].concat(vertex), [ends[0]].concat(vertex)]),
          depths: [-3].concat(subsubspace.depths)};
        subspaces.push(subspace);
      } else {
        for (let t of ts) {
          let subspace = {
            vertices: subsubspace.vertices.map(
              vertex => [t.pos].concat(vertex)),
            depths: [t.depth].concat(subsubspace.depths)};
          subspaces.push(subspace);
        }
      }
    }
    return subspaces;
  }
}

function computeLineGrid(starts, ends, stepSizes = [1, .25], lines = []) {
  let dims = [...starts.keys()];
  let tickss =
    dims.map(dim => computeTicks(starts[dim], ends[dim], stepSizes));
  for (let dim of dims) {
    computeGridSubspaces(tickss, new Set([dim]), starts, ends, lines);
  }
  return lines;
}

function computeGridLineObjects(lines,
    materials = {
      // frame: new THREE.LineBasicMaterial({
      //   color: 0x000000, linewidth: 3}),
      major: new THREE.LineBasicMaterial({
        color: false ? 0xffffff : 0x000000, transparent: true, opacity: .25}),
      // minor: new THREE.LineBasicMaterial({
      //   color: false ? 0xffffff : 0x000000, transparent: true, opacity: .05})},
      minorBound: new THREE.LineBasicMaterial({
        color: false ? 0xffffff : 0x000000, transparent: true, opacity: .05})},
    predicates = {
      // frame: line => Math.max(...line.depths) < 0,
      // major: line => Math.max(...line.depths) == 0,
      major: line => Math.max(...line.depths) <= 0,
      // minor: line => Math.max(...line.depths) > 0}) {
      minorBound: line => (Math.max(...line.depths) > 0) &&
        line.depths.reduce((hasBound, x) => hasBound || x == -1 || x == -2,
          false)}) {
  let objs = [];
  for (let k of Object.keys(predicates)) {
    if (Object.hasOwn(materials, k)) {
      let vs = new Float32Array(lines.filter(predicates[k]).map(
        line => line.vertices).flat(2));
      let geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(vs, 3));
      objs.push(new THREE.LineSegments(geometry, materials[k]));
    }
  }
  return objs;
}

function computeArrowGeometry(length = 1, radius = length * .05,
    headLength = length * .75, headRadius = radius * 3.5,
    headBaseOffset = headLength * -.2, basePerimeterOffset = radius,
    nSegments = 16) {
  let vertices = []; let indices = [];
  let iBaseCenter = nSegments * 3;
  let iHeadTip = iBaseCenter + 1;
  for (let iSegment = 0; iSegment < nSegments; iSegment++) {
    let phi = 2 * Math.PI * iSegment / nSegments;
    let [x, y] = [Math.cos(phi), Math.sin(phi)];
    vertices.push(
      x * radius, y * radius, basePerimeterOffset, // Base perimeter
      x * radius, y * radius, length, // Head base perimeter: inner
      x * headRadius, y * headRadius, length + headBaseOffset); // outer
    let iCurrent = iSegment * 3;
    let iNext = (iCurrent + 3) % (nSegments * 3);
    indices.push(
      iBaseCenter, iNext, iCurrent, // Base disk
      iCurrent, iNext, iCurrent + 1, // Tube
      iCurrent + 1, iNext, iNext + 1, // Tube
      iCurrent + 1, iNext + 1, iCurrent + 2, // Head base ring
      iCurrent + 2, iNext + 1, iNext + 2, // Head base ring
      iCurrent + 2, iNext + 2, iHeadTip); // Head cone
  }
  vertices.push(
    0., 0., 0., // Base center
    0., 0., length + headLength); // Head tip

  let geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position',
    new THREE.BufferAttribute(new Float32Array(vertices), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function eulerToQuaternion(rotEuler) {
  let rotQuarternion = new THREE.Quaternion();
  rotQuarternion.setFromEuler(rotEuler);
  return rotQuarternion;
}

function valueOr(x, v = 0) {
  return (x == null) ? v : x;
}

function rotToEuler(rot) {
  let deg2rad = (Math.PI / 180);
  return new THREE.Euler(
    valueOr(rot.x) * deg2rad,
    valueOr(rot.y) * deg2rad,
    valueOr(rot.z) * deg2rad);
}

function posToVector(pos) {
  return new THREE.Vector3(
    valueOr(pos.x),
    valueOr(pos.y),
    valueOr(pos.z));
}

function oriToQuarternion(ori) {
  return new THREE.Quaternion(
    valueOr(ori.x),
    valueOr(ori.y),
    valueOr(ori.z),
    valueOr(ori.w));
}

function poseToMatrix4(pose) {
  let pos = posToVector(pose.pos);
  let ori = oriToQuarternion(pose.ori);
  let scale = new THREE.Vector3(1, 1, 1);

  let a = new THREE.Matrix4();
  a.compose(pos, ori, scale);
  return a;
}

function getXYZ(xyzs, i) {
  return {x: xyzs.x[i], y: xyzs.y[i], z: xyzs.z[i]};
}

function getXYZW(xyzws, i) {
  return {x: xyzws.x[i], y: xyzws.y[i], z: xyzws.z[i], w: xyzws.w[i]};
}

function getPose(posXYZs, oriXYZWs, i) {
  return {pos: getXYZ(posXYZs, i), ori: getXYZW(oriXYZWs, i)};
}

function trajectoryAsInstancedMesh(
    geometry, material, posEarth, oriEarth) {
  let n = sublength(posEarth);
  let mesh = new THREE.InstancedMesh(geometry, material, n);
  for (let i = 0; i < n; i++) {
    mesh.setMatrixAt(i, poseToMatrix4(getPose(posEarth, oriEarth, i)));
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function trajectoriesAsInstancedMeshes(geometry, trajectoryData,
    materials = [
      new THREE.MeshLambertMaterial({color: 0xff0000}),
      new THREE.MeshLambertMaterial({color: 0x00ff00}),
      new THREE.MeshLambertMaterial({color: 0x0000ff})],
    quaternions = [
      eulerToQuaternion(rotToEuler({y: 90})),
      eulerToQuaternion(rotToEuler({x: -90})),
      eulerToQuaternion(rotToEuler({}))]) {
  let posEarth = trajectoryData.pos.earth;
  let oriEarth = trajectoryData.ori.earth;
  return Object.keys(posEarth).flatMap(
    sensor => ([...quaternions.keys()].map(i => {
      let g = geometry.clone();
      g.applyQuaternion(quaternions[i]);
      return trajectoryAsInstancedMesh(
        g, materials[i], posEarth[sensor], oriEarth[sensor]);
    })));
}

export function attachTrajectoryPlot(container, trajectoryData, opts = {}) {
  const width = container.clientWidth;
  const height = container.clientHeight;

  const scene = new THREE.Scene();
  if (opts.backgroundColor != null) {
    scene.background = new THREE.Color(opts.backgroundColor);
  }
  const camera = new THREE.PerspectiveCamera(
    75, width / height, 0.1, 1000);

  let change = false;

  // const renderer = new THREE.WebGLRenderer({alpha: true});
  // const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true,
    preserveDrawingBuffer: true});
  renderer.setSize(width, height);

  function animate() {
    if (change) {
      renderer.render(scene, camera);
      change = false;
    }
  }

  renderer.setAnimationLoop(animate);
  container.appendChild(renderer.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(2.5, 2.5, 2.5);
  scene.add(light);

  const arrowSize = .05;

  const arrowGeometry = computeArrowGeometry(arrowSize);

  scene.add(...trajectoriesAsInstancedMeshes(arrowGeometry,
    trajectoryData));

  const gridBlueprintObjects = computeGridLineObjects(
    computeLineGrid([0, 0, 0], [1, 1, 1]));
  for (let origin of boxesOriginsMapAsArray(trajectoryBoxesOriginsMap(
      trajectoryData.pos.earth, x => {
          let pad = .25;
          return [Math.floor(x - pad), Math.floor(x + arrowSize + pad)];
        }))) {
    for (let gridBlueprintObject of gridBlueprintObjects) {
      let gridObject = gridBlueprintObject.clone();
      gridObject.position.add(new THREE.Vector3(...origin));
      scene.add(gridObject);
    }
  }

  const cameraSpeed = {
    vel: {
      slow: .01,
      fast: .5},
    gyr: {
      slow: .25,
      fast: 1.}};

  const mulBy = (y) => ((x) => x * y);

  function cameraAdjust(vel, gyr, fast = false, cam = camera, factorVel = 1.,
      factorGyr = factorVel) {
    let allowRoll = false;
    let mode = fast ? "fast" : "slow";

    if (gyr != null) {
      if (!allowRoll) { gyr[2] = gyr[1]; }
      let factor = factorGyr * (Math.PI / 180) * (cameraSpeed.gyr[mode]);
      let gyrEul = new THREE.Euler(...(gyr.map(mulBy(factor))));
      let gyrQua = new THREE.Quaternion().setFromEuler(gyrEul);
      cam.quaternion.multiply(gyrQua);
    }

    if (vel != null) {
      let factor = factorVel * (cameraSpeed.vel[mode]);
      let velVec = new THREE.Vector3(...(vel.map(mulBy(factor))));
      cam.position.add(velVec.applyQuaternion(cam.quaternion));
    }

    if (!allowRoll) {
      let e = new THREE.Euler();
      e.setFromQuaternion(cam.quaternion);
      e.reorder("ZYX");
      e.y = 0;
      cam.quaternion.setFromEuler(e);
    }

    change = true;
  }

  function cameraReset(
      pos = [-.5, .5, .5],
      rot = [Math.PI * .7, Math.PI, 0],
      fov = 60,
      cam = camera) {
    cam.position.fromArray(pos);
    cam.quaternion.setFromEuler(new THREE.Euler(...rot));
    cam.fov = fov;
    cam.updateProjectionMatrix();
    change = true;

    // TODO: This is of course ugly (but then again, all of this code is ugly at
    // the moment). I am just using it here to make a nicer default position
    // that does not roll the camera.
    cameraAdjust([0., 0., 0.], [.0, -.7, 0.],
      false, camera, 1., 100.);
  }

  cameraReset();

  const keyboardVels = {
    a: [-1,  0,  0],
    d: [ 1,  0,  0],
    s: [ 0,  0,  1],
    w: [ 0,  0, -1],
    q: [ 0, -1,  0],
    e: [ 0,  1,  0]};

  const keyboardGyrs = {
    h: [ 0,  5,  0],
    l: [ 0, -5,  0],
    j: [-5,  0,  0],
    k: [ 5,  0,  0]};

  function cameraAdjustByKeyboard(event, cam = camera) {
    if (event.key == "Enter") {
      cameraReset();
    } else if ((new Set(["-", "=", "_", "+"])).has(event.key)) {
      let small = 1;
      let large = 10;
      if (event.key == "-") {
        cam.fov += small;
      } else if (event.key == "_") {
        cam.fov += large;
      } else if (event.key == "=") {
        cam.fov -= small;
      } else if (event.key == "+") {
        cam.fov -= large;
      }
      cam.updateProjectionMatrix();
      change = true;
    } else {
      let c = event.key.toLowerCase();
      let fast = c != event.key;
      let vel = keyboardVels[c];
      let gyr = keyboardGyrs[c];
      cameraAdjust(vel, gyr, fast, cam);
    }
  }

  function cameraAdjustByMouse(event, cam = camera) {
    if (event.buttons != 0) {
      let vel = [0., 0., 0.];
      let gyr = [0., 0., 0.];
      if (event.buttons == 1) {
        vel[0] = event.movementX;
        vel[1] = -event.movementY;
      } else if (event.buttons == 2) {
        gyr[1] = -event.movementX;
        gyr[0] = -event.movementY;
      }
      cameraAdjust(vel, gyr, event.shiftKey, cam);
    }
  }

  function cameraAdjustByWheel(event, cam = camera) {
    // let vel = [event.deltaX, event.deltaZ., event.deltaY];
    let vel = [0., 0., event.deltaY];

    // let gyr = null;
    function shape(x0) {
      return Math.max(Math.min(x0 * x0 * x0, 1), -1);
      // let x1 = Math.abs(x0);
      // let x2 = Math.max(0, x1 * 1.5 - .5);
      // let x3 = Math.min(x2 * x2 * x2, 1);
      // let x4 = x3 * Math.sign(x0);
      // return x4;
    }
    function polar(x, y, shape = x => x) {
      let mag = Math.sqrt(x * x + y * y);
      let arg = Math.atan2(y, x);
      let magShaped = shape(mag);
      return [magShaped * Math.cos(arg), magShaped * Math.sin(arg)];
    }
    let xy = polar(
      2 * event.clientY / container.clientWidth - 1,
      2 * event.clientX / container.clientHeight - 1,
      shape)
    let gyr = [xy[0] * 3 * event.deltaY, xy[1] * 3 * event.deltaY, 0.];

    cameraAdjust(vel, gyr, event.shiftKey, cam, .25);
  }

  // container.addEventListener("keydown", console.log);
  // document.addEventListener("keydown", cameraAdjustByKeyboard);
  container.addEventListener("mousemove", cameraAdjustByMouse);
  // container.addEventListener("wheel", cameraAdjustByWheel);
  container.addEventListener("dblclick", () => cameraReset());

  container.oncontextmenu = () => false;

  // Render at least once, after everything has been set up
  renderer.render(scene, camera); // Better for PDF export
  // change = true;

  // ---- Rest of the function is an addendum suggested by ChatGPT to ensure
  // that a rendering is included in PDF exports
  // // put this near the end of attachTrajectoryPlot, after renderer is created & scene is ready
  // let printImg = null;

  // function ensurePrintImage() {
  //   if (!printImg) {
  //     // optional: bump resolution for sharper PDFs
  //     // const { clientWidth:w, clientHeight:h } = container;
  //     // renderer.setSize(w * 2, h * 2, false);
  //     // renderer.render(scene, camera);

  //     const dataURL = renderer.domElement.toDataURL('image/png');
  //     printImg = new Image();
  //     printImg.src = dataURL;
  //     printImg.style.width = '100%';
  //     printImg.style.height = 'auto';
  //     printImg.style.display = 'none';
  //     container.appendChild(printImg);
  //   }
  // }

  // function beforePrint() {
  //   ensurePrintImage();
  //   renderer.domElement.style.display = 'none';
  //   printImg.style.display = '';
  // }

  // function afterPrint() {
  //   if (printImg) printImg.style.display = 'none';
  //   renderer.domElement.style.display = '';
  // }

  // // works in Chromium
  // window.addEventListener('beforeprint', beforePrint);
  // window.addEventListener('afterprint', afterPrint);

  // // extra safety: some engines only fire the matchMedia listener
  // const mm = window.matchMedia('print');
  // if (mm && mm.addEventListener) {
  //   mm.addEventListener('change', (e) => e.matches ? beforePrint() : afterPrint());
  // }
}

// -------- old code graveyard

// function number_columns_to_numbers(data, cols = Object.keys(data[0])) {
//   for (let row of data) {
//     for (let k of cols) {
//       row[k] = +(row[k]);
//     }
//   }
//   return data;
// }

// async function load_single_sensor_data(name) {
//   let url = "/" + name + ".csv";
//   let head = await fetch(url, {method: "HEAD"});
//   let data = [];
//   if (head.ok) {
//     data = number_columns_to_numbers(await d3.csv("/" + name + ".csv"));
//   }

//   // In case the server pretends the file exists when it doesn't
//   if (data.length > 0 && Object.hasOwn(data[0], "<!DOCTYPE html>")) {
//     data = [];
//   }

//   return Object.fromEntries([[name, data]]);
// }

// async function load_multi_sensor_data(names = ["left", "right", "trunk"]) {
//   return Object.assign({},
//     ...(await Promise.all(names.map(load_single_sensor_data))));
// }

// console.log(trajectoryData);

// function elwise(op) {
//   return function(...xss) {
//     let n = Math.max(...xss.map(xs => xs.length));
//     let js = [...xss.keys()]
//     let ys = Array(n);
//     for (i = 0; i < n; i++) {
//       let args = js.map(j => xss[j][i]);
//       ys[i] = op(...args);
//     }
//     return ys;
//   }
// }

// const elwise_add =
//   elwise((...xs) => xs.reduce((x0, x1) => x0 + x1, 0));

// function trajectory_extents(poses,
//     round = [Math.floor, Math.ceil],
//     names = ["pos_x", "pos_y", "pos_z"],
//     inits = [Infinity, -Infinity].map(x => Array(names.length).fill(x)),
//     fs = [Math.min, Math.max]) {
//   let extents = poses.reduce((exs, row) => {
//       for (let i = 0; i < names.length; i++) {
//         for (let j = 0; j < fs.length; j++) {
//           exs[j][i] = fs[j](exs[j][i], row[names[i]])
//         }
//       }
//       return exs;
//     }, inits);
//   if (round != null) {
//     for (let i = 0; i < extents.length; i++) {
//       extents[i] = extents[i].map(x => fs[0](x));
//     }
//   }
//   return extents;
// }

// function origins_array_to_boxes(os, size = [1, 1, 1]) {
//   let is = [...size.keys()];
//   return os.map(origin => elwise_add(origin, size));
// }

// function translate_grid_subspaces(subspaces, by) {
//   return subspaces.map(subspace => {
//       return {
//         vertices: subspace.vertices.map(vertex => elwise_add(vertex, by)),
//         depths: subspace.depths};
//     });
// }

