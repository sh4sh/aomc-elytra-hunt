// Prints the End Cities that cubiomes finds, for checking this app's generator.
//
// Build inside a checkout of https://github.com/Cubitect/cubiomes :
//
//   cc -O2 -ffp-contract=off end-cities-ref.c noise.c biomenoise.c biomes.c \
//      finders.c generator.c layers.c util.c quadbase.c -lm -o end-cities-ref
//
// -ffp-contract=off matters: without it some compilers merge a multiply and an
// add into one step, which rounds differently from Java and changes a few
// results far from 0,0.
//
// Usage: end-cities-ref <seed> <rx0> <rx1> <rz0> <rz1>
// Covers regions [rx0, rx1) x [rz0, rz1); a region is 20 chunks (320 blocks).
// Prints "chunkX chunkZ hasShip" for every End City.

#include "finders.h"
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv)
{
    if (argc < 6) {
        fprintf(stderr, "usage: %s <seed> <rx0> <rx1> <rz0> <rz1>\n", argv[0]);
        return 1;
    }
    uint64_t seed = strtoull(argv[1], 0, 10);
    int rx0 = atoi(argv[2]), rx1 = atoi(argv[3]), rz0 = atoi(argv[4]), rz1 = atoi(argv[5]);
    Generator g;
    setupGenerator(&g, MC_1_21, 0);
    applySeed(&g, DIM_END, seed);
    SurfaceNoise sn;
    initSurfaceNoise(&sn, DIM_END, seed);
    for (int rz = rz0; rz < rz1; rz++) {
        for (int rx = rx0; rx < rx1; rx++) {
            Pos p;
            if (!getStructurePos(End_City, MC_1_21, seed, rx, rz, &p)) continue;
            if (!isViableStructurePos(End_City, &g, p.x, p.z, 0)) continue;
            if (!isViableEndCityTerrain(&g, &sn, p.x, p.z)) continue;
            Piece pieces[END_CITY_PIECES_MAX];
            int n = getEndCityPieces(pieces, seed, p.x >> 4, p.z >> 4), ship = 0;
            for (int i = 0; i < n; i++) if (pieces[i].type == END_SHIP) ship = 1;
            printf("%d %d %d\n", p.x >> 4, p.z >> 4, ship);
        }
    }
    return 0;
}
