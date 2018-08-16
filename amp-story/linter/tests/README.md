These tests should not be used right now.

They need to be redone:

1. everything should be ported to use nock
1. the nock recording mechanism needs to be made more reliable

In particular, when in recording mode, nock needs to be used sequentially, so
that it can attribute the correct requests and responses to the correct
fixtures.