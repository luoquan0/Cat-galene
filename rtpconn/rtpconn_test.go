package rtpconn

import (
	"testing"

	"github.com/jech/galene/rtptime"
)

func TestDownTrackAtomics(t *testing.T) {
	down := &rtpDownTrack{
		atomics:        &downTrackAtomics{},
		maxBitrate:     new(bitrate),
		maxREMBBitrate: new(bitrate),
	}

	down.SetTimeOffset(1, 2)
	down.setRTT(3)
	down.setSRTime(4, 5)
	down.maxBitrate.Set(6, rtptime.Jiffies())
	down.maxREMBBitrate.Set(7, rtptime.Jiffies())
	info := layerInfo{8, 9, 10, 11, 12, 13, true}
	down.setLayerInfo(info)
	ntp, rtp := down.getTimeOffset()
	rtt := down.getRTT()
	sr, srntp := down.getSRTime()
	br, sbr, tbr := down.GetMaxBitrate()
	info2 := down.getLayerInfo()
	if ntp != 1 || rtp != 2 || rtt != 3 || sr != 4 || srntp != 5 ||
		br != 6 || sbr != 8 || tbr != 11 {
		t.Errorf(
			"Expected 1 2 3 4 5 6 8 11, "+
				"got %v %v %v %v %v %v %v %v",
			ntp, rtp, rtt, sr, srntp, br, sbr, tbr,
		)
	}
	if info2 != info {
		t.Errorf("Expected %v, got %v", info, info2)
	}
}

func TestSadd(t *testing.T) {
	ts := []struct{ x, y, z uint64 }{
		{0, 0, 0},
		{1, 2, 3},
		{^uint64(0) - 10, 5, ^uint64(0) - 5},
		{^uint64(0) - 10, 15, ^uint64(0)},
	}
	for _, tt := range ts {
		z := sadd(tt.x, tt.y)
		if z != tt.z {
			t.Errorf("%v + %v: expected %v, got %v",
				tt.x, tt.y, tt.z, z,
			)
		}
	}
}
func TestScreenShareStartsWithUsefulBitrate(t *testing.T) {
	for _, test := range []struct {
		label string
		want  uint64
	}{
		{"screenshare", initialScreenShareBitrate},
		{"camera", 512 * 1024},
		{"video", 512 * 1024},
	} {
		track := &rtpDownTrack{
			conn: &rtpDownConnection{
				remote: &rtpUpConnection{label: test.label},
			},
			atomics:        &downTrackAtomics{},
			maxBitrate:     new(bitrate),
			maxREMBBitrate: new(bitrate),
		}
		got, _, _ := track.GetMaxBitrate()
		if got != test.want {
			t.Errorf("%s: startup estimate %d, want %d", test.label, got, test.want)
		}

		// Moderate loss is not a congestion event; its first report
		// must preserve the chosen startup rate.
		track.updateRate(10, rtptime.Jiffies())
		got = track.maxBitrate.Get(rtptime.Jiffies())
		initial := uint64(initLossRate)
		if test.label == "screenshare" {
			initial = initialScreenShareBitrate
		}
		if got != initial {
			t.Errorf("%s: initial loss estimate %d, want %d",
				test.label, got, initial)
		}

		// Explicit receiver bandwidth feedback must still cap the
		// share's requested bitrate.
		track.maxREMBBitrate.Set(250000, rtptime.Jiffies())
		got, _, _ = track.GetMaxBitrate()
		if got != 250000 {
			t.Errorf("%s: receiver estimate ignored: %d", test.label, got)
		}

		track.updateRate(80, rtptime.Jiffies())
		reduced := track.maxBitrate.Get(rtptime.Jiffies())
		if reduced >= initial {
			t.Errorf("%s: loss failed to lower estimate: %d", test.label, reduced)
		}
	}
}
