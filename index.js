import * as THREE from "three";


export const printSomething = () => {
  console.log("Hello there");
  const x = new THREE.Vector3(1, 2, 3);
  console.log(x);
};

export const testThis = () => {
document.addEventListener("DOMContentLoaded", function() {

const container = document.getElementById("trajectory-plot-0");

// console.log("asd2");
console.log(container);

const scene = new THREE.Scene();

// scene.background = new THREE.Color(0x00ffffff);


const camera = new THREE.PerspectiveCamera(75,
  container.clientWidth / container.clientHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({alpha: true});
renderer.setSize(
  container.clientWidth, container.clientHeight);
renderer.setAnimationLoop( animate );
container.appendChild(renderer.domElement);

const geometry = new THREE.BoxGeometry( 1, 1, 1 );
const material = new THREE.MeshBasicMaterial( { color: 0xffff00 } );
const cube = new THREE.Mesh( geometry, material );
scene.add( cube );

camera.position.z = 5;

function animate() {

        cube.rotation.x += 0.01;
        cube.rotation.y += 0.01;

        renderer.render( scene, camera );

}

});
};
